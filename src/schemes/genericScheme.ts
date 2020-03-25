import { Arc } from '../arc'
import { Proposal, IProposalBaseCreateOptions } from '../proposal'
import { Address } from '../types'
import {
  ITransaction,
  ITransactionReceipt,
  getEventArgs
} from '../operation'

export interface IGenericSchemeInfo {
  id: string
  contractToCall: Address
  votingMachine: Address
}

export interface IGenericScheme {
  id: string
  contractToCall: Address
  callData: string
  executed: boolean
  returnValue: string
}

export interface IProposalCreateOptionsGS extends IProposalBaseCreateOptions {
  callData?: string
  value?: number
}

export enum IProposalType {
  GenericScheme = 'GenericScheme' // propose a contributionReward
}

export async function createProposalTransaction(options: IProposalCreateOptionsGS, context: Arc): Promise<ITransaction> {
  if (options.callData === undefined) {
    throw new Error(`Missing argument "callData" for GenericScheme in Proposal.create()`)
  }
  if (options.value === undefined) {
    throw new Error(`Missing argument "value" for GenericScheme in Proposal.create()`)
  }
  if (options.scheme === undefined) {
    throw new Error(`Missing argument "scheme" for GenericScheme in Proposal.create()`)
  }

  options.descriptionHash = await context.saveIPFSData(options)

  return {
    contract: context.getContract(options.scheme),
    method: 'proposeCall',
    args: [
      options.callData,
      options.value,
      options.descriptionHash
    ]
  }
}

/**
 * map the transaction receipt of the createTransaction call to a nice result
 * @param  options  the options passed to the createProposal call
 * @param  context an Arc instance
 * @return         [description]
 */
export function createProposalTransactionMap(options: IProposalCreateOptionsGS, context: Arc) {
  return async (receipt: ITransactionReceipt) => {
    const args = getEventArgs(receipt, 'NewCallProposal', 'GenericScheme.createProposal')
    const proposalId = args[1]
    return new Proposal(proposalId, context)
  }
}
