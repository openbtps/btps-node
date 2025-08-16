import { readFileSync } from 'fs';
import { BtpsAuthentication } from '../../dist/core/authentication/BtpsAuthentication.js';

const publicKey = readFileSync('./keys/finance/finance-public.pem');
const privateKey = readFileSync('./keys/finance/finance-private.pem');
const publicKey2 = readFileSync('./keys/billing/billing-public.pem');
const privateKey2 = readFileSync('./keys/billing/billing-private.pem');
const publicKey3 = readFileSync('./keys/hr/hr-public.pem');
const privateKey3 = readFileSync('./keys/hr/hr-private.pem');

(async () => {
  const identity = 'finance$ebilladdress.com';
  // const result = await BtpsAuthentication.authenticate(
  //   identity,
  //   'YDVKSEU4CEEW',
  //   {
  //     publicKey: publicKey.toString('utf8'),
  //     privateKey: privateKey.toString('utf8'),
  //   },
  //   {
  //     deviceName: 'iPhone 15',
  //     appVersion: '1.0.0',
  //   },
  //   {
  //     host: 'localhost',
  //     port: 3443,
  //     maxRetries: 0,
  //     btpMtsOptions: {
  //       rejectUnauthorized: false,
  //     },
  //   },
  // );
  // console.log('result authRequest', result);
  // const { agentId, refreshToken, expiresAt } = result.response.document;
  // console.log('expiresAt', expiresAt);
  const refreshResult = await BtpsAuthentication.refreshSession(
    'btps_ag_e0c57f36-91c2-42b1-8f4d-470f3131f249',
    identity,
    'evr4-SYmRMR1fx2t9fIgLoqYyjf6NrbqoXlY646uqis',
    {
      publicKey: publicKey.toString('utf8'),
      privateKey: privateKey.toString('utf8'),
    },
    {
      deviceName: 'iPhone 20',
      appVersion: '3.0.0',
    },
    {
      host: 'localhost',
      port: 3443,
      maxRetries: 0,
      btpMtsOptions: {
        rejectUnauthorized: false,
      },
    },
  );
  console.log('refreshResult', JSON.stringify(refreshResult, null, 2));
})();

// private async processMessage(data: ProcessedArtifact, resCtx: ArtifactResCtx): Promise<void> {
//   const { artifact, isAgentArtifact } = data;

//   if (isAgentArtifact) {
//     const { respondNow } = data;

//     if (respondNow) {
//       await this.awaitableEmit('agentArtifact', {
//         ...artifact,
//         respondNow,
//       }, resCtx);
//     } else {
//       this.emitter.emit('agentArtifact', {
//         ...artifact,
//         respondNow,
//       }, resCtx);
//     }
//   } else {
//     this.emitter.emit('transporterArtifact', artifact);
//   }

//   await this._forwardArtifact(data);
// }

// private async awaitableEmit(
//   event: 'agentArtifact',
//   ...args: Parameters<(typeof this.emitter)['emit']>
// ): Promise<void> {
//   const listeners = this.emitter.listeners(event);
//   await Promise.all(
//     listeners.map((listener) => {
//       try {
//         const result = listener(...args);
//         return result instanceof Promise ? result : Promise.resolve();
//       } catch (e) {
//         console.error(`[BtpsServer] Error in handler for '${event}':`, e);
//         return Promise.resolve(); // swallow errors
//       }
//     }),
//   );
// }
