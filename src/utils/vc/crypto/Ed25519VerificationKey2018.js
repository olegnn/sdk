import b58 from 'bs58';
import { Ed25519VerKeyName } from './constants';

const { u8aToHex } = require('@polkadot/util');
const { signatureVerify } = require('@polkadot/util-crypto/signature');

export default class Ed25519VerificationKey2018 {
  constructor(publicKey) {
    this.publicKey = [...publicKey];
  }

  /**
   * Construct the public key object from the verification method
   * @param verificationMethod
   * @returns {Ed25519VerificationKey2018}
   */
  static from(verificationMethod) {
    if (verificationMethod.type !== Ed25519VerKeyName && !verificationMethod.publicKeyBase58) {
      throw new Error('verification method should have type Sr25519VerificationKey2020 and have the base58 public key');
    }
    return new this(b58.decode(verificationMethod.publicKeyBase58));
  }

  /**
   * Construct the verifier factory that has the verify method using the current public key
   * @returns {object}
   */
  verifier() {
    return Ed25519VerificationKey2018.verifierFactory(this.publicKey);
  }

  /**
   * Verifier factory that returns the object with the verify method
   * @param publicKey
   * @returns {object}
   */
  static verifierFactory(publicKey) {
    return {
      async verify({ data, signature }) {
        const pk = u8aToHex(publicKey);
        return signatureVerify(data, signature, pk).isValid;
      },
    };
  }
}
