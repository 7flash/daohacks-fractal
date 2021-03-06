/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import { Contract, Signer } from 'ethers'
import { Provider } from '@ethersproject/providers'

import type { ProxySetter } from '../ProxySetter'

export class ProxySetter__factory {
  static connect(
    address: string,
    signerOrProvider: Signer | Provider
  ): ProxySetter {
    return new Contract(address, _abi, signerOrProvider) as ProxySetter
  }
}

const _abi = [
  {
    inputs: [],
    name: 'getBeacon',
    outputs: [
      {
        internalType: 'address',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
]
