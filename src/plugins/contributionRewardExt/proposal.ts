import BN from 'bn.js'
import { Proposal, IProposalState } from "../proposal";
import { Address, IApolloQueryOptions } from "../../types";
import { Arc } from "../../arc";
import { Plugin } from '../plugin'
import { Observable, from } from "rxjs";
import gql from "graphql-tag";
import { ContributionRewardProposal } from '../contributionReward/proposal';
import { ContributionRewardExt } from './plugin';
import { NULL_ADDRESS } from '../../utils';
import { CONTRIBUTION_REWARD_DUMMY_VERSION, REDEEMER_CONTRACT_VERSIONS } from '../../settings';
import { ITransaction, Operation, ITransactionReceipt, toIOperationObservable } from '../../operation';
import { concatMap } from 'rxjs/operators';

export interface IContributionRewardExtProposalState extends IProposalState {
  beneficiary: Address
  externalTokenReward: BN
  externalToken: Address
  ethReward: BN
  nativeTokenReward: BN
  periods: number
  periodLength: number
  reputationReward: BN
  alreadyRedeemedNativeTokenPeriods: number
  alreadyRedeemedReputationPeriods: number
  alreadyRedeemedExternalTokenPeriods: number
  alreadyRedeemedEthPeriods: number
  reputationChangeLeft: BN | null
  nativeTokenRewardLeft: BN | null
  ethRewardLeft: BN | null
  externalTokenRewardLeft: BN | null
}

export class ContributionRewardExtProposal extends Proposal<IContributionRewardExtProposalState> {

  static itemMap(context: Arc, item: any): ContributionRewardProposal | null {

    if (item === null || item === undefined) return null

    const ethRewardLeft = (
      item.contributionReward.ethRewardLeft !== null &&
      new BN(item.contributionReward.ethRewardLeft) ||
      null
    )
    const externalTokenRewardLeft = (
      item.contributionReward.externalTokenRewardLeft !== null &&
      new BN(item.contributionReward.externalTokenRewardLeft) ||
      null
    )
    const nativeTokenRewardLeft = (
      item.contributionReward.nativeTokenRewardLeft !== null &&
      new BN(item.contributionReward.nativeTokenRewardLeft) ||
      null
    )
    const reputationChangeLeft = (
      item.contributionReward.reputationChangeLeft !== null &&
      new BN(item.contributionReward.reputationChangeLeft) ||
      null
    )

    const contributionRewardExt = ContributionRewardExt.itemMap(context, item) as ContributionRewardExt
    const contributionRewardExtProposal = new ContributionRewardExtProposal(context, item.id)

    const baseState = Proposal.itemMapToBaseState(
      context,
      item,
      contributionRewardExt,
      contributionRewardExtProposal,
      "ContributionRewardExt"
    )

    if (baseState == null) return null

    const state: IContributionRewardExtProposalState = {
      ...baseState,
      alreadyRedeemedEthPeriods: Number(item.contributionReward.alreadyRedeemedEthPeriods),
      alreadyRedeemedExternalTokenPeriods: Number(item.contributionReward.alreadyRedeemedExternalTokenPeriods),
      alreadyRedeemedNativeTokenPeriods: Number(item.contributionReward.alreadyRedeemedNativeTokenPeriods),
      alreadyRedeemedReputationPeriods: Number(item.contributionReward.alreadyRedeemedReputationPeriods),
      beneficiary: item.contributionReward.beneficiary,
      ethReward: new BN(item.contributionReward.ethReward),
      ethRewardLeft,
      externalToken: item.contributionReward.externalToken,
      externalTokenReward: new BN(item.contributionReward.externalTokenReward),
      externalTokenRewardLeft,
      nativeTokenReward: new BN(item.contributionReward.nativeTokenReward),
      nativeTokenRewardLeft,
      periodLength: Number(item.contributionReward.periodLength),
      periods: Number(item.contributionReward.periods),
      reputationChangeLeft,
      reputationReward: new BN(item.contributionReward.reputationReward)
    }

    return new ContributionRewardExtProposal(context, state)
  }

  public state(apolloQueryOptions: IApolloQueryOptions): Observable<IContributionRewardExtProposalState> {
    const query = gql`query ProposalState
      {
        proposal(id: "${this.id}") {
          ...ProposalFields
          votes {
            id
          }
          stakes {
            id
          }
        }
      }
      ${Proposal.baseFragment}
      ${Plugin.baseFragment}
    `

    const result = this.context.getObservableObject(this.context, query, ContributionRewardExtProposal.itemMap, apolloQueryOptions) as Observable<IContributionRewardExtProposalState>
    return result
  }

  public redeemerContract() {
    for (const version of REDEEMER_CONTRACT_VERSIONS) {
      try {
        const contractInfo = this.context.getContractInfoByName('Redeemer', version)
        return this.context.getContract(contractInfo.address)
      } catch (err) {
        if (!err.message.match(/no contract/i)) {
          // if the contract cannot be found, try the next one
          throw err
        }
      }
    }
    throw Error(`No Redeemer contract could be found (search for versions ${REDEEMER_CONTRACT_VERSIONS})`)
  }

  public redeemRewards(beneficiary?: Address): Operation<boolean> {

    const mapReceipt = (receipt: ITransactionReceipt) => true

    const createTransaction = async (): Promise<ITransaction> => {

      if (!beneficiary) {
        beneficiary = NULL_ADDRESS
      }

      const state = await this.fetchState()
      const pluginAddress = this.context.getContractInfoByName('ContributionReward', CONTRIBUTION_REWARD_DUMMY_VERSION).address
      const method = 'redeemFromCRExt'
      const args = [
        pluginAddress,
        state.votingMachine,
        this.id,
        beneficiary
      ]

      return {
        contract: this.redeemerContract(),
        method,
        args
      }
    }

    const observable = from(createTransaction()).pipe(
      concatMap((transaction) => {
        return this.context.sendTransaction(transaction, mapReceipt)
      })
    )

    return toIOperationObservable(observable)
  }
}