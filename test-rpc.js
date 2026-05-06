import { getRpc } from './server/services/rpc.js';

async function test() {
  const rpc = getRpc('bps');
  try {
    const info = await rpc.getNetworkInfo();
    console.log('Network:', info.connections);
  } catch (err) {
    console.error('Failed:', err.message);
  }
}
test();
