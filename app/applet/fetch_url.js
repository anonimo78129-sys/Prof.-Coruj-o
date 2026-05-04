import https from 'https';

https.get('https://ibb.co/0jxC27WK', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const match = data.match(/<meta property="og:image" content="(https:\/\/i\.ibb\.co\/[^"]+)"/);
    if (match) {
      console.log('FOUND_URL:', match[1]);
    } else {
      console.log('NOT_FOUND');
    }
  });
});
