/* Imports: External */
import { BigNumber, ethers, constants } from 'ethers'
import { getContractFactory } from '@eth-optimism/contracts'
import {
  fromHexString,
  toHexString,
  toRpcHexString,
  EventArgsSequencerBatchAppended,
} from '@eth-optimism/core-utils'

/* Imports: Internal */
import {
  DecodedSequencerBatchTransaction,
  SequencerBatchAppendedExtraData,
  SequencerBatchAppendedParsedEvent,
  TransactionBatchEntry,
  TransactionEntry,
  EventHandlerSet,
} from '../../../types'
import {
  SEQUENCER_ENTRYPOINT_ADDRESS,
  SEQUENCER_GAS_LIMIT,
  parseSignatureVParam,
} from '../../../utils'

export const handleEventsSequencerBatchAppended: EventHandlerSet<
  EventArgsSequencerBatchAppended,
  SequencerBatchAppendedExtraData,
  SequencerBatchAppendedParsedEvent
> = {
  getExtraData: async (event, l1RpcProvider) => {
    const l1Transaction = await event.getTransaction()
    const eventBlock = await event.getBlock()

    // TODO: We need to update our events so that we actually have enough information to parse this
    // batch without having to pull out this extra event. For the meantime, we need to find this
    // "TransactonBatchAppended" event to get the rest of the data.
    const OVM_CanonicalTransactionChain = getContractFactory(
      'OVM_CanonicalTransactionChain'
    )
      .attach(event.address)
      .connect(l1RpcProvider)

    const batchSubmissionEvent = (
      await OVM_CanonicalTransactionChain.queryFilter(
        OVM_CanonicalTransactionChain.filters.TransactionBatchAppended(),
        eventBlock.number,
        eventBlock.number
      )
    ).find((foundEvent: ethers.Event) => {
      // We might have more than one event in this block, so we specifically want to find a
      // "TransactonBatchAppended" event emitted immediately before the event in question.
      return (
        foundEvent.transactionHash === event.transactionHash &&
        foundEvent.logIndex === event.logIndex - 1
      )
    })

    if (!batchSubmissionEvent) {
      throw new Error(
        `Well, this really shouldn't happen. A SequencerBatchAppended event doesn't have a corresponding TransactionBatchAppended event.`
      )
    }

    return {
      timestamp: eventBlock.timestamp,
      blockNumber: eventBlock.number,
      submitter: l1Transaction.from,
      l1TransactionHash: l1Transaction.hash,
      l1TransactionData: l1Transaction.data,
      gasLimit: `${SEQUENCER_GAS_LIMIT}`,

      prevTotalElements: batchSubmissionEvent.args._prevTotalElements,
      batchIndex: batchSubmissionEvent.args._batchIndex,
      batchSize: batchSubmissionEvent.args._batchSize,
      batchRoot: batchSubmissionEvent.args._batchRoot,
      batchExtraData: batchSubmissionEvent.args._extraData,
    }
  },
  parseEvent: (event, extraData, l2ChainId) => {
    const transactionEntries: TransactionEntry[] = []

    // It's easier to deal with this data if it's a Buffer.
    const calldata = fromHexString(extraData.l1TransactionData)

    if (calldata.length < 12) {
      throw new Error(
        `Block ${extraData.blockNumber} transaction data is invalid for decoding: ${extraData.l1TransactionData} , ` +
          `converted buffer length is < 12.`
      )
    }
    const numContexts = BigNumber.from(calldata.slice(12, 15)).toNumber()
    let transactionIndex = 0
    let enqueuedCount = 0
    let nextTxPointer = 15 + 16 * numContexts
    for (let i = 0; i < numContexts; i++) {
      const contextPointer = 15 + 16 * i
      const context = parseSequencerBatchContext(calldata, contextPointer)

      for (let j = 0; j < context.numSequencedTransactions; j++) {
        const sequencerTransaction = parseSequencerBatchTransaction(
          calldata,
          nextTxPointer
        )

        const decoded = maybeDecodeSequencerBatchTransaction(
          sequencerTransaction,
          l2ChainId
        )

        transactionEntries.push({
          index: extraData.prevTotalElements
            .add(BigNumber.from(transactionIndex))
            .toNumber(),
          batchIndex: extraData.batchIndex.toNumber(),
          blockNumber: BigNumber.from(context.blockNumber).toNumber(),
          timestamp: BigNumber.from(context.timestamp).toNumber(),
          gasLimit: BigNumber.from(extraData.gasLimit).toString(),
          target: SEQUENCER_ENTRYPOINT_ADDRESS,
          origin: null,
          data: toHexString(sequencerTransaction),
          queueOrigin: 'sequencer',
          value: decoded ? decoded.value : '0x0',
          queueIndex: null,
          decoded,
          confirmed: true,
        })

        nextTxPointer += 3 + sequencerTransaction.length
        transactionIndex++
      }

      for (let j = 0; j < context.numSubsequentQueueTransactions; j++) {
        const queueIndex = event.args._startingQueueIndex.add(
          BigNumber.from(enqueuedCount)
        )

        // Okay, so. Since events are processed in parallel, we don't know if the Enqueue
        // event associated with this queue element has already been processed. So we'll ask
        // the api to fetch that data for itself later on and we use fake values for some
        // fields. The real TODO here is to make sure we fix this data structure to avoid ugly
        // "dummy" fields.
        transactionEntries.push({
          index: extraData.prevTotalElements
            .add(BigNumber.from(transactionIndex))
            .toNumber(),
          batchIndex: extraData.batchIndex.toNumber(),
          blockNumber: BigNumber.from(0).toNumber(),
          timestamp: BigNumber.from(0).toNumber(),
          gasLimit: BigNumber.from(0).toString(),
          target: constants.AddressZero,
          origin: constants.AddressZero,
          data: '0x',
          queueOrigin: 'l1',
          value: '0x0',
          queueIndex: queueIndex.toNumber(),
          decoded: null,
          confirmed: true,
        })

        enqueuedCount++
        transactionIndex++
      }
    }

    const transactionBatchEntry: TransactionBatchEntry = {
      index: extraData.batchIndex.toNumber(),
      root: extraData.batchRoot,
      size: extraData.batchSize.toNumber(),
      prevTotalElements: extraData.prevTotalElements.toNumber(),
      extraData: extraData.batchExtraData,
      blockNumber: BigNumber.from(extraData.blockNumber).toNumber(),
      timestamp: BigNumber.from(extraData.timestamp).toNumber(),
      submitter: extraData.submitter,
      l1TransactionHash: extraData.l1TransactionHash,
    }

    return {
      transactionBatchEntry,
      transactionEntries,
    }
  },
  storeEvent: async (entry, db) => {
    await db.putTransactionBatchEntries([entry.transactionBatchEntry])
    await db.putTransactionEntries(entry.transactionEntries)

    // Add an additional field to the enqueued transactions in the database
    // if they have already been confirmed
    for (const transactionEntry of entry.transactionEntries) {
      if (transactionEntry.queueOrigin === 'l1') {
        await db.putTransactionIndexByQueueIndex(
          transactionEntry.queueIndex,
          transactionEntry.index
        )
      }
    }
  },
}

interface SequencerBatchContext {
  numSequencedTransactions: number
  numSubsequentQueueTransactions: number
  timestamp: number
  blockNumber: number
}

const parseSequencerBatchContext = (
  calldata: Buffer,
  offset: number
): SequencerBatchContext => {
  return {
    numSequencedTransactions: BigNumber.from(
      calldata.slice(offset, offset + 3)
    ).toNumber(),
    numSubsequentQueueTransactions: BigNumber.from(
      calldata.slice(offset + 3, offset + 6)
    ).toNumber(),
    timestamp: BigNumber.from(
      calldata.slice(offset + 6, offset + 11)
    ).toNumber(),
    blockNumber: BigNumber.from(
      calldata.slice(offset + 11, offset + 16)
    ).toNumber(),
  }
}

const parseSequencerBatchTransaction = (
  calldata: Buffer,
  offset: number
): Buffer => {
  const transactionLength = BigNumber.from(
    calldata.slice(offset, offset + 3)
  ).toNumber()

  return calldata.slice(offset + 3, offset + 3 + transactionLength)
}

const maybeDecodeSequencerBatchTransaction = (
  transaction: Buffer,
  l2ChainId: number
): DecodedSequencerBatchTransaction | null => {
  try {
    const decodedTx = ethers.utils.parseTransaction(transaction)

    return {
      nonce: BigNumber.from(decodedTx.nonce).toNumber(),
      gasPrice: BigNumber.from(decodedTx.gasPrice).toNumber(),
      gasLimit: BigNumber.from(decodedTx.gasLimit).toString(),
      value: toRpcHexString(decodedTx.value),
      target: toHexString(decodedTx.to), // Maybe null this out for creations?
      data: toHexString(decodedTx.data),
      sig: {
        v: parseSignatureVParam(decodedTx.v, l2ChainId),
        r: toHexString(decodedTx.r),
        s: toHexString(decodedTx.s),
      },
    }
  } catch (err) {
    return null
  }
}
