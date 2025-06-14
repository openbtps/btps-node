/* eslint-disable @typescript-eslint/no-var-requires */
// test-client.js (CommonJS compatible)
const tls = require('tls');
const fs = require('fs');

const mockRequest = {
  id: '46fad228-a344-45c2-960e-0743b2b3c85f',
  version: '1.0.0',
  to: 'finance$ebilladdress.com',
  from: 'finance$ebilladdress.com',
  type: 'btp_trust_request',
  issuedAt: '2025-06-14T15:32:34.027Z',
  document:
    'zTJSEoqtTbSZ5PsLz5SPG+mv8K9pQFV4TfTMMUdhIBrQdjW/5Eo7SlkXMDYlThL+XdcaDuFzD0xcCsHlla7QHAzHtXp4Qp2Zcad82j/pcCCXKlOuDyTjTJO8ZyON5mMVMujEszYxRXJPxDQHhBxFpbBg4ScCXdvmB45PlFAQqX+i0RoEovJzeZoeYz9juLbb3wQVh1cm4Wj/ORdMyp21MdiqDNXX9d7RcgIiYmRyQHQohQVL4Cj/TVm2X/bq8gYE32/IKpK9H7QgsCY9DnWrm9shbkYz0WikDV06WVOdG2Yb7Wn4ffI9bymalPMD2CxHG8w3Dj+7Tp/EJaLgsxrRVpNs88HNojff0W2+SfNiMkwPq7Qtiq5uWoAI/P7EZwGVrVHV5AZ9JSe941LXq4Yl/w==',
  encryption: {
    algorithm: 'aes-256-cbc',
    encryptedKey:
      'P1jzWYnJq8CA5rnLhQf2LKiPOTyoJxhNSQ1lSbP/27+5OguDiZ8dz9ECjh3n6TNy7jmA1HxTrgjLwIs0fTQ8evRp3nbr2egoDq3FvDl3BzhW908+NiqERcW5Z6qax2qK2JWlAIb5ioiJ7H7bJqiCAIdmvCsYEBxp2iq8qxbYxptbxyVOG53vB4hmo9BKXLffNiItWrW51Lvdhtf6e/YAxKyl/1d49GMX1F6XK0uFsQryGt0MNbN2OVwb397gcf2/ulMnBQWKNZIOAA+mBOzn/M4R2UCOsvieKAbiDDLf4O0DTipMyjpCFBobOjyDb0wGSGGxnT8Wp24ujcy3jJ1PVg==',
    iv: 'URyz0AyN4oH6sIWRTD3nNQ==',
    type: 'standardEncrypt',
  },
  signature: {
    algorithm: 'sha256',
    value:
      'QnSOoI6wHHykjPE5YF88AHTAQtDDmGeTPXl7XoO2q+ilIkDZ8Ox0tNowi5E000SrF+F8jGEX45potVeS87O+QfR9koClyqnphLIdy4A2G55HxgXEz4iSZslrymJNQdm3DWGqpM3h1hFY9gORBIryVcUmpoudLl9BEvebAXgrK3xdrDHoOX7keGsMkPdYGN0wflwduFLz0b5C+qB2/C8QfUXFb3dbuOBjt7WrE9oXC2oFW1JJD8hhceYOKyxs8TrHIrITDNrKU2OdA8TsX3dS9PEAJ5tx0BXqScekFCga4JN55lmzqdyFKDKZLGN3VzlYwqctFh275w/v4uzubXS+5A==',
    fingerprint: 'wsmLAnYc5MUn7G5FLfx0WXNirLyxQVrHKmGoXGPgRkg=',
  },
};

const socket = tls.connect(
  {
    host: 'btps.ebilladdress.com',
    port: 3443,
    key: fs.readFileSync('./certs/client-key.pem'),
    cert: fs.readFileSync('./certs/client-cert.pem'),
    ca: fs.readFileSync(
      require('child_process').execSync('mkcert -CAROOT').toString().trim() + '/rootCA.pem',
      'utf8',
    ),
    rejectUnauthorized: true,
  },
  () => {
    console.log('[BTPS CLIENT] Connected to server');

    // Send as JSON + newline (split2 expects line-delimited JSON)
    socket.write(JSON.stringify(mockRequest) + '\n');
    console.log('[BTPS CLIENT] sent data to server');
  },
);

socket.on('data', (data) => {
  console.log('[BTPS CLIENT] Received:\n', JSON.parse(data));
  socket.end();
});

socket.on('end', () => {
  console.log('[BTPS CLIENT] Connection closed');
});
