import { ApiPromise, WsProvider, Keyring } from '@polkadot/api';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import { KeyringPair } from '@polkadot/keyring/types'; // eslint-disable-line

import TokenMigration from './modules/migration';

import types from './types.json';
import PoaRpcDefs from './poa-rpc-defs';

// Default modules to load on init
const defaultModules = ['did', 'blob', 'revocation', 'poa'];

/**
 * @typedef {object} Options The Options to use in the function DockAPI.
 * @property {string} [address] The node address to connect to.
 * @property {object} [keyring] PolkadotJS keyring
 * @property {object} [chainTypes] Types for the chain
 * @property {object} [chainRpc] RPC definitions for the chain
 * @property {array} [modules] Array of module types to load
 */

/** Helper class to interact with the Dock chain */
class DockAPI {
  /**
   * Creates a new instance of the DockAPI object, call init to initialize
   * @param {function} [customSignTx] - Optional custom transaction sign method,
   * a function that expects `extrinsic` as first argument and a dock api instance as second argument
   * @constructor
   */
  constructor(customSignTx) {
    this.customSignTx = customSignTx;
    this.modules = {};
  }

  /**
   * Initializes the SDK and connects to the node
   * @param {Options} config - Configuration options
   * @return {Promise} Promise for when SDK is ready for use
   */
  async init({
    address,
    keyring,
    chainTypes,
    chainRpc,
    modules = defaultModules,
  } = {
    address: null,
    keyring: null,
  }) {
    const loadPoaModules = modules.indexOf('poa');
    if (this.api) {
      if (this.api.isConnected) {
        throw new Error('API is already connected');
      } else {
        this.disconnect();
      }
    }

    this.address = address || this.address;

    // If RPC methods given, use them else set it to empty object.
    let rpc = chainRpc || {};

    // If using PoA module, extend the RPC methods with PoA specific ones.
    if (loadPoaModules) {
      rpc = Object.assign(rpc, PoaRpcDefs);
    }

    this.api = await ApiPromise.create({
      provider: new WsProvider(this.address),
      types: chainTypes || types,
      // @ts-ignore: TS2322
      rpc,
    });

    // Wait for keyring and crypto ready
    await this.initKeyring(keyring);

    // Load modules
    for (let i = 0; i < modules.length; i++) {
      await this.loadModule(modules[i]);
    }

    // Bonus token migration module if using PoA
    if (loadPoaModules) {
      this.migrationModule = new TokenMigration(this.api);
    }

    return this.api;
  }

  async loadModule(type) {
    const ModuleClass = await import('./modules/' + type);
    const moduleInstance = new ModuleClass.default(this.api, this.signAndSend.bind(this));
    this.modules[type] = moduleInstance;
  }

  async initKeyring(keyring = null) {
    if (!this.keyring || keyring) {
      await cryptoWaitReady();
      this.keyring = new Keyring(keyring || { type: 'sr25519' });
    }
  }

  destroyModules() {
    for (let k in this.modules) {
      delete this.modules[k];
    }
  }

  async disconnect() {
    if (this.api) {
      if (this.api.isConnected) {
        await this.api.disconnect();
      }
      delete this.api;
      this.destroyModules();
    }
  }

  isInitialized() {
    return !!this.api;
  }

  /** TODO: Should probably use set/get and rename account to _account
   * Sets the account used to sign transactions
   * @param {KeyringPair} account - PolkadotJS Keyring account
   */
  setAccount(account) {
    this.account = account;
  }

  /**
   * Gets the current account used to sign transactions
   * @return {KeyringPair} PolkadotJS Keyring account
   */
  getAccount() {
    return this.account;
  }

  /**
   * Signs an extrinsic with either the set account or a custom sign method (see constructor)
   * @param {object} extrinsic - Extrinsic to send
   * @param {object} params - An object used to parameters like nonce, etc to the extrinsic
   * @return {Promise}
   */
  async signExtrinsic(extrinsic, params = {}) {
    if (this.customSignTx) {
      await this.customSignTx(extrinsic, params, this);
    } else {
      await extrinsic.signAsync(this.getAccount(), params);
    }
  }

  /**
   * Helper function to send transaction
   * @param {object} extrinsic - Extrinsic to send
   * @param {Boolean} waitForFinalization - If true, waits for extrinsic's block to be finalized,
   * else only wait to be included in block.
   * @param {object} params - An object used to parameters like nonce, etc to the extrinsic
   * @return {Promise}
   */
  async signAndSend(extrinsic, waitForFinalization = true, params = {}) {
    await this.signExtrinsic(extrinsic, params);
    const promise = new Promise((resolve, reject) => {
      try {
        let unsubFunc = null;
        return extrinsic.send(({ events = [], status }) => {
          // If waiting for finalization
          if (waitForFinalization && status.isFinalized) {
            unsubFunc();
            resolve({
              events,
              status,
            });
          }

          // If not waiting for finalization, wait for inclusion in block.
          if (!waitForFinalization && status.isInBlock) {
            unsubFunc();
            resolve({
              events,
              status,
            });
          }
        })
          .catch((error) => {
            reject(error);
          })
          .then((unsub) => {
            unsubFunc = unsub;
          });
      } catch (error) {
        reject(error);
      }

      return this;
    });

    const result = await promise;
    return result;
  }

  /**
   * Checks if the API instance is connected to the node
   * @return {Boolean} The connection status
   */
  get isConnected() {
    if (!this.api) {
      return false;
    }

    return this.api.isConnected;
  }

  /**
   * Gets the SDK's Blob module
   * @return {BlobModule} The module to use
   */
  get blob() {
    if (!this.modules['blob']) {
      throw new Error('Unable to get Blob module, SDK is not initialised');
    }
    return this.modules['blob'];
  }

  /**
   * Gets the SDK's DID module
   * @return {DIDModule} The module to use
   */
  get did() {
    if (!this.modules['did']) {
      throw new Error('Unable to get DID module, SDK is not initialised');
    }
    return this.modules['did'];
  }

  /**
   * Gets the SDK's revocation module
   * @return {RevocationModule} The module to use
   */
  get revocation() {
    if (!this.modules['revocation']) {
      throw new Error('Unable to get revocation module, SDK is not initialised');
    }
    return this.modules['revocation'];
  }

  /**
   * Get the PoA module
   * @return {PoAModule} The module to use
   */
  get poa() {
    if (!this.modules['poa']) {
      throw new Error('Unable to get PoA module, SDK is not initialised');
    }
    return this.modules['poa'];
  }
}

export default new DockAPI();
export {
  DockAPI,
  defaultModules,
};
