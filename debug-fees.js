import { btcRpc, bpsRpc } from './server/services/rpc.js';

async function checkFees() {
  console.log('--- BTC FEE CHECK ---');
  try {
    const btcSmart = await btcRpc.call('estimatesmartfee', [6]);
    console.log('BTC Smart Fee:', btcSmart);
  } catch (e) { console.log('BTC Smart Fee Failed:', e.message); }
  
  try {
    const btcNet = await btcRpc.call('getnetworkinfo');
    console.log('BTC Relay Fee:', btcNet.relayfee);
  } catch (e) { console.log('BTC GetNetworkInfo Failed:', e.message); }

  console.log('\n--- BPS FEE CHECK ---');
  try {
    const bpsSmart = await bpsRpc.call('estimatesmartfee', [6]);
    console.log('BPS Smart Fee:', bpsSmart);
  } catch (e) { console.log('BPS Smart Fee Failed:', e.message); }
  
  try {
    const bpsNet = await bpsRpc.call('getnetworkinfo');
    console.log('BPS Relay Fee:', bpsNet.relayfee);
  } catch (e) { console.log('BPS GetNetworkInfo Failed:', e.message); }
}

checkFees();
