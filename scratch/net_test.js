async function test() {
  console.log('Testing connectivity...');
  try {
    const res = await fetch('https://www.google.com');
    console.log('Google connection: SUCCESS (Status ' + res.status + ')');
  } catch (e) {
    console.log('Google connection: FAILED - ' + e.message);
  }

  try {
    const res = await fetch('https://hf-mirror.com');
    console.log('HF Mirror connection: SUCCESS (Status ' + res.status + ')');
  } catch (e) {
    console.log('HF Mirror connection: FAILED - ' + e.message);
  }
}
test();
