import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import net from 'net';
import { loadConfig } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * NodeManager — Lifecycle management for the integrated BPS Core daemon.
 */
class NodeManager {
  constructor() {
    this.child = null;
    this.status = 'stopped';
    // Determine binary path based on operating system and architecture
    const platform = process.platform;
    const arch = process.arch;

    if (platform === 'win32') {
      this.binaryPath = path.join(__dirname, '..', '..', 'bin', 'win', 'bitcoin-posd.exe');
    } else if (platform === 'darwin') {
      // For macOS, we usually support Intel (x64) or Apple Silicon (arm64)
      this.binaryPath = path.join(__dirname, '..', '..', 'bin', 'mac', 'bitcoin-posd');
    } else if (platform === 'linux') {
      // For Linux, we support multiple architectures
      const archFolder = arch === 'x64' ? 'x64' : (arch === 'arm64' ? 'arm64' : (arch === 'arm' ? 'arm' : (arch === 'ia32' ? 'ia32' : null)));
      if (archFolder) {
        this.binaryPath = path.join(__dirname, '..', '..', 'bin', 'linux', archFolder, 'bitcoin-posd');
      } else {
        // Fallback or specific detection for RISC-V etc.
        this.binaryPath = path.join(__dirname, '..', '..', 'bin', 'linux', arch, 'bitcoin-posd');
      }
    } else {
      this.binaryPath = null;
    }
    // Store data in the user's AppData folder
    this.dataDir = path.join(process.env.APPDATA || process.env.HOME, 'NextChangeHub', 'bps-data');
    this.rpcUser = 'nxh_user';
    this.rpcPass = 'nxh_pass_6284';
    this.rpcPort = 9333; // Shifted from default 9332 to avoid conflicts
    this.p2pPort = 48931; // Shifted from default 48930 to avoid conflicts
  }

  async isRpcResponding() {
    return new Promise((resolve) => {
      const socket = net.connect(this.rpcPort, '127.0.0.1', () => {
        socket.end();
        resolve(true);
      });
      socket.on('error', () => {
        resolve(false);
      });
      socket.setTimeout(1000);
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
    });
  }

  async start() {
    if (this.child) return;
    
    // Check if node is already running (e.g. from a previous Hub session or manually started)
    const alreadyRunning = await this.isRpcResponding();
    if (alreadyRunning) {
      console.log('[NodeManager] BPS RPC is already responding. Assuming node is running.');
      this.status = 'running';
      
      // Ensure wallet is initialized since we didn't start the node ourselves
      import('./rpc.js').then(({ getRpc }) => {
        getRpc('bps').initWallet().catch(err => {
          console.warn('[NodeManager] Warning during wallet initialization:', err.message);
        });
      }).catch(err => console.error('[NodeManager] Failed to load RPC module:', err.message));
      
      return;
    }
    
    console.log('[NodeManager] Initializing BPS Integrated Node...');

    // 1. Ensure data directory exists
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    // 2. Check if binary exists
    if (!this.binaryPath || !fs.existsSync(this.binaryPath)) {
      console.warn(`[NodeManager] ⚠ BPS binary not found at ${this.binaryPath}`);
      console.warn('Please place bpsd.exe in the /bin folder to use integrated mode.');
      this.status = 'missing_binary';
      return;
    }

    // 3. Generate bps.conf if missing or needs update
    const confPath = path.join(this.dataDir, 'bps.conf');
    const appConfig = loadConfig();
    
    const config = [
      'server=1',
      `rpcuser=${this.rpcUser}`,
      `rpcpassword=${this.rpcPass}`,
      `rpcport=${this.rpcPort}`,
      `port=${this.p2pPort}`,
      'listen=1',
      appConfig.bpsPruneEnabled !== false ? `prune=${appConfig.bpsPruneMaxMB || 2000}` : '',
      'printtoconsole=1',
      'rpcallowip=127.0.0.1',
      'addnode=127.0.0.1:48930', // Connect to user's other local node (default port)
      'addnode=109.250.137.136:48930', // Public network fallback node
      'addnode=151.68.237.175:48930', // Public network fallback node
      'addnode=85.197.21.48:48930'    // Public network fallback node
    ].join('\n');
    
    fs.writeFileSync(confPath, config);

    // 4. Start the process
    this.status = 'starting';
    this.child = spawn(this.binaryPath, [
      `-datadir=${this.dataDir}`,
      `-conf=${confPath}`
    ], {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    console.log(`[NodeManager] Process started (PID: ${this.child.pid})`);

    this.child.stdout.on('data', (data) => {
      const line = data.toString();
      if (line.includes('Done loading')) {
        this.status = 'running';
        console.log('[NodeManager] ✓ BPS Node is now fully loaded and running');
        
        // Automatically initialize the wallet immediately after node startup
        import('./rpc.js').then(({ getRpc }) => {
          console.log('[NodeManager] Ensuring built-in wallet is loaded...');
          getRpc('bps').initWallet().catch(err => {
            console.warn('[NodeManager] Warning during wallet initialization:', err.message);
          });
        }).catch(err => console.error('[NodeManager] Failed to load RPC module:', err.message));
      }
      // Log important events
      if (line.includes('Error') || line.includes('Warning')) {
        console.warn(`[BPS Daemon] ${line.trim()}`);
      }
    });

    this.child.stderr.on('data', (data) => {
      console.error(`[BPS Daemon Error] ${data.toString().trim()}`);
    });

    this.child.on('exit', (code) => {
      console.log(`[NodeManager] BPS Process exited with code ${code}`);
      this.status = 'stopped';
      this.child = null;
    });

    this.child.on('error', (err) => {
      console.error('[NodeManager] Failed to start process:', err.message);
      this.status = 'error';
      this.child = null;
    });
  }

  stop() {
    if (this.child) {
      console.log('[NodeManager] Stopping BPS node...');
      this.child.kill();
      this.status = 'stopped';
      this.child = null;
    }
  }

  async restart() {
    console.log('[NodeManager] Restarting BPS node to apply new settings...');
    this.stop();
    // Wait a bit for process to release file locks
    await new Promise(resolve => setTimeout(resolve, 2000));
    return this.start();
  }

  getStatus() {
    return {
      status: this.status,
      dataDir: this.dataDir,
      rpcPort: this.rpcPort
    };
  }
}

// Singleton
let _manager = null;
export function getNodeManager() {
  if (!_manager) _manager = new NodeManager();
  return _manager;
}
