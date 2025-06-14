import { BTP_ERROR_IDENTITY, BTP_ERROR_RESOLVE_PUBKEY } from '@core/error/constant';
import { decryptBtpPayload, verifySignature } from '.';
import { BTPCryptoArtifact, BTPCryptoResponse, PemKeys } from './types';
import { parseIdentity, resolvePublicKey } from '@core/utils';
import { ParsedIdentity } from '@core/utils/types';
import { BTPErrorException } from '@core/error';
import { BTPDocType } from '@core/server/types';

const genDecryptError = (error: BTPErrorException) => ({
  payload: undefined,
  error,
});

export const decryptVerify = async <T extends BTPDocType>(
  from: string,
  receiver: ParsedIdentity & { pemFiles: PemKeys },
  encryptedPayload: BTPCryptoArtifact<T>,
): Promise<BTPCryptoResponse> => {
  const parsedSender = parseIdentity(from);
  if (!parsedSender) return genDecryptError(new BTPErrorException(BTP_ERROR_IDENTITY));

  const senderPubPem = await resolvePublicKey(from);
  if (!senderPubPem) return genDecryptError(new BTPErrorException(BTP_ERROR_RESOLVE_PUBKEY));
  const { signature, ...signedArtifact } = encryptedPayload;

  const docToVerify = {
    ...signedArtifact,
    from,
    to: `${receiver.accountName}$${receiver.domainName}`,
  };

  const { isValid, error: sigError } = verifySignature(docToVerify, signature, senderPubPem);

  if (!isValid && sigError) {
    return genDecryptError(sigError);
  }

  const { encryption, document } = signedArtifact;
  const needsDecryption = !!encryption;

  const { privateKey } = receiver.pemFiles;
  const { data: decryptedPayload, error: decryptionErrors } = needsDecryption
    ? decryptBtpPayload(document, encryption, privateKey)
    : { data: document, error: undefined };

  if (!decryptedPayload && decryptionErrors) return genDecryptError(decryptionErrors);

  return {
    payload: {
      ...signedArtifact,
      document: decryptedPayload as T,
      signature,
    },
    error: undefined,
  };
};
