/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import {
  ethers,
  EventFilter,
  Signer,
  BigNumber,
  BigNumberish,
  PopulatedTransaction,
} from 'ethers'
import {
  Contract,
  ContractTransaction,
  CallOverrides,
} from '@ethersproject/contracts'
import { BytesLike } from '@ethersproject/bytes'
import { Listener, Provider } from '@ethersproject/providers'
import { FunctionFragment, EventFragment, Result } from '@ethersproject/abi'

interface ArbInfoInterface extends ethers.utils.Interface {
  functions: {
    'getBalance(address)': FunctionFragment
    'getCode(address)': FunctionFragment
  }

  encodeFunctionData(functionFragment: 'getBalance', values: [string]): string
  encodeFunctionData(functionFragment: 'getCode', values: [string]): string

  decodeFunctionResult(functionFragment: 'getBalance', data: BytesLike): Result
  decodeFunctionResult(functionFragment: 'getCode', data: BytesLike): Result

  events: {}
}

export class ArbInfo extends Contract {
  connect(signerOrProvider: Signer | Provider | string): this
  attach(addressOrName: string): this
  deployed(): Promise<this>

  on(event: EventFilter | string, listener: Listener): this
  once(event: EventFilter | string, listener: Listener): this
  addListener(eventName: EventFilter | string, listener: Listener): this
  removeAllListeners(eventName: EventFilter | string): this
  removeListener(eventName: any, listener: Listener): this

  interface: ArbInfoInterface

  functions: {
    getBalance(account: string, overrides?: CallOverrides): Promise<[BigNumber]>

    'getBalance(address)'(
      account: string,
      overrides?: CallOverrides
    ): Promise<[BigNumber]>

    getCode(account: string, overrides?: CallOverrides): Promise<[string]>

    'getCode(address)'(
      account: string,
      overrides?: CallOverrides
    ): Promise<[string]>
  }

  getBalance(account: string, overrides?: CallOverrides): Promise<BigNumber>

  'getBalance(address)'(
    account: string,
    overrides?: CallOverrides
  ): Promise<BigNumber>

  getCode(account: string, overrides?: CallOverrides): Promise<string>

  'getCode(address)'(
    account: string,
    overrides?: CallOverrides
  ): Promise<string>

  callStatic: {
    getBalance(account: string, overrides?: CallOverrides): Promise<BigNumber>

    'getBalance(address)'(
      account: string,
      overrides?: CallOverrides
    ): Promise<BigNumber>

    getCode(account: string, overrides?: CallOverrides): Promise<string>

    'getCode(address)'(
      account: string,
      overrides?: CallOverrides
    ): Promise<string>
  }

  filters: {}

  estimateGas: {
    getBalance(account: string, overrides?: CallOverrides): Promise<BigNumber>

    'getBalance(address)'(
      account: string,
      overrides?: CallOverrides
    ): Promise<BigNumber>

    getCode(account: string, overrides?: CallOverrides): Promise<BigNumber>

    'getCode(address)'(
      account: string,
      overrides?: CallOverrides
    ): Promise<BigNumber>
  }

  populateTransaction: {
    getBalance(
      account: string,
      overrides?: CallOverrides
    ): Promise<PopulatedTransaction>

    'getBalance(address)'(
      account: string,
      overrides?: CallOverrides
    ): Promise<PopulatedTransaction>

    getCode(
      account: string,
      overrides?: CallOverrides
    ): Promise<PopulatedTransaction>

    'getCode(address)'(
      account: string,
      overrides?: CallOverrides
    ): Promise<PopulatedTransaction>
  }
}
