import BN = require('bn.js')
import gql from 'graphql-tag'
import { from, Observable } from 'rxjs'
import { concatMap, filter, first } from 'rxjs/operators'
import { Arc, IApolloQueryOptions } from './arc'
import { DAO } from './dao'
import { IGenesisProtocolParams, mapGenesisProtocolParams } from './genesisProtocol'
import { IObservable } from './graphnode'
import { Operation, toIOperationObservable, ITransaction, ITransactionReceipt, getEventArgs } from './operation'
import { IQueueState } from './queue'
import { IRewardQueryOptions, Reward } from './reward'
import { ISchemeState, Scheme } from './scheme'
import { ICompetitionProposalState, IProposalCreateOptionsComp } from './schemes/competition'
import * as ContributionReward from './schemes/contributionReward'
import * as ContributionRewardExt from './schemes/contributionRewardExt'
import * as GenericScheme from './schemes/genericScheme'
import * as SchemeRegistrar from './schemes/schemeRegistrar'
import { CONTRIBUTION_REWARD_DUMMY_VERSION, REDEEMER_CONTRACT_VERSIONS } from './settings'
import { IStakeQueryOptions, Stake } from './stake'
import { Address, Date, ICommonQueryOptions, IStateful } from './types'
import {
  createGraphQlQuery, isAddress, NULL_ADDRESS, realMathToNumber,
  secondSinceEpochToDate
} from './utils'
import { IVoteQueryOptions, Vote } from './vote'

export const IProposalType = {
  ...ContributionReward.IProposalType,
  ...GenericScheme.IProposalType,
  ...SchemeRegistrar.IProposalType
}

type IProposalType = (
  ContributionReward.IProposalType |
  GenericScheme.IProposalType |
  SchemeRegistrar.IProposalType
)

export enum IProposalOutcome {
  None,
  Pass,
  Fail
}

export enum IProposalStage {
  ExpiredInQueue,
  Executed,
  Queued,
  PreBoosted,
  Boosted,
  QuietEndingPeriod
}

export enum IExecutionState {
  None,
  QueueBarCrossed,
  QueueTimeOut,
  PreBoostedBarCrossed,
  BoostedTimeOut,
  BoostedBarCrossed
}

export interface IProposalStaticState {
  id: string
  dao: DAO
  scheme: ISchemeState
  votingMachine: Address
}

export interface IProposalState extends IProposalStaticState {
  accountsWithUnclaimedRewards: Address[],
  boostedAt: Date
  contributionReward: ContributionReward.IContributionReward | null
  competition: ICompetitionProposalState | null
  confidenceThreshold: number
  closingAt: Date
  createdAt: Date
  descriptionHash?: string
  description?: string
  downStakeNeededToQueue: BN
  executedAt: Date
  executionState: IExecutionState
  expiresInQueueAt: Date
  genericScheme: GenericScheme.IGenericScheme | null
  genesisProtocolParams: IGenesisProtocolParams
  organizationId: string
  paramsHash: string
  preBoostedAt: Date
  proposal: Proposal
  proposer: Address
  queue: IQueueState
  quietEndingPeriodBeganAt: Date
  schemeRegistrar: SchemeRegistrar.ISchemeRegistrar | null
  resolvedAt: Date
  stage: IProposalStage
  stakesFor: BN
  stakesAgainst: BN
  tags?: string[]
  title?: string
  totalRepWhenCreated: BN
  totalRepWhenExecuted: BN
  type: IProposalType,
  upstakeNeededToPreBoost: BN
  url?: string
  votesFor: BN
  votesAgainst: BN
  votesCount: number
  voteOnBehalf: Address
  winningOutcome: IProposalOutcome
}

export class Proposal implements IStateful<IProposalState> {
  public static fragments = {
    ProposalFields: gql`fragment ProposalFields on Proposal {
      id
      accountsWithUnclaimedRewards
      boostedAt
      closingAt
      confidenceThreshold
      competition {
        id
        admin
        endTime
        contract
        suggestionsEndTime
        createdAt
        numberOfWinningSuggestions
        numberOfVotesPerVoters
        numberOfWinners
        rewardSplit
        snapshotBlock
        startTime
        totalSuggestions
        totalVotes
        votingStartTime

      }
      contributionReward {
        id
        beneficiary
        ethReward
        ethRewardLeft
        externalToken
        externalTokenReward
        externalTokenRewardLeft
        nativeTokenReward
        nativeTokenRewardLeft
        periods
        periodLength
        reputationReward
        reputationChangeLeft
        alreadyRedeemedReputationPeriods
        alreadyRedeemedExternalTokenPeriods
        alreadyRedeemedNativeTokenPeriods
        alreadyRedeemedEthPeriods
      }
      createdAt
      dao {
        id
        schemes {
          id
          address
        }
      }
      description
      descriptionHash
      executedAt
      executionState
      expiresInQueueAt
      genericScheme {
        id
        contractToCall
        callData
        executed
        returnValue
      }
      genesisProtocolParams {
        id
        activationTime
        boostedVotePeriodLimit
        daoBountyConst
        limitExponentValue
        minimumDaoBounty
        preBoostedVotePeriodLimit
        proposingRepReward
        queuedVotePeriodLimit
        queuedVoteRequiredPercentage
        quietEndingPeriod
        thresholdConst
        votersReputationLossRatio
      }
      gpRewards {
        id
      }
      scheme {
        ...SchemeFields
      }
      gpQueue {
        id
        threshold
        votingMachine
      }
      organizationId
      preBoostedAt
      proposer
      quietEndingPeriodBeganAt
      schemeRegistrar {
        id
        schemeToRegister
        schemeToRegisterParamsHash
        schemeToRegisterPermission
        schemeToRemove
        decision
        schemeRegistered
        schemeRemoved
      }
      stage
      # stakes { id }
      stakesFor
      stakesAgainst
      tags {
        id
      }
      totalRepWhenCreated
      totalRepWhenExecuted
      title
      url
      # votes { id }
      votesAgainst
      votesFor
      votingMachine
      winningOutcome
    }`
  }

  /**
   * Search for proposals
   * @param  options            Search options, must implemeent IProposalQueryOptions
   * @param  context            An instance of Arc
   * @param  apolloQueryOptions [description]
   * @return                    An observable of lists of results
   *
   * For example:
   *    Proposal.search({ stage: IProposalStage.Queued})
   */
  public static search(
    context: Arc,
    options: IProposalQueryOptions = {},
    apolloQueryOptions: IApolloQueryOptions = {}
  ): Observable<Proposal[]> {
    let where = ''

    if (!options.where) { options.where = {} }

    for (const key of Object.keys(options.where)) {
      const value = options.where[key]
      if (key === 'stage' && value !== undefined) {
        where += `stage: "${IProposalStage[value as IProposalStage]}"\n`
      } else if (key === 'stage_in' && Array.isArray(value)) {
        const stageValues = value.map((stage: number) => '"' + IProposalStage[stage as IProposalStage] + '"')
        where += `stage_in: [${stageValues.join(',')}]\n`
      } else if (key === 'type') {
        // TODO: we are not distinguishing between the schemeregisterpropose
        // and SchemeRegistrarProposeToRemove proposals
        if (value.toString().includes('SchemeRegistrar')) {
          where += `schemeRegistrar_not: null\n`
        } else {
          if (IProposalType[value] === undefined) {
            throw Error(`Unknown value for "type" in proposals query: ${value}`)
          }
          const apolloKey = IProposalType[value][0].toLowerCase() + IProposalType[value].slice(1)
          where += `${apolloKey}_not: null\n`
        }
      } else if (Array.isArray(options.where[key])) {
        // Support for operators like _in
        const values = options.where[key].map((val: number) => '"' + val + '"')
        where += `${key}: [${values.join(',')}]\n`
      } else {
        if (key === 'proposer' || key === 'beneficiary' || key === 'dao') {
          const option = options.where[key] as string
          isAddress(option)
          where += `${key}: "${option.toLowerCase()}"\n`
        } else {
          where += `${key}: "${options.where[key]}"\n`
        }
      }
    }
    let query

    if (apolloQueryOptions.fetchAllData === true) {
      query = gql`query ProposalsSearchAllData
        {
          proposals ${createGraphQlQuery(options, where)} {
            ...ProposalFields
            votes {
              id
            }
            stakes {
              id
            }
          }
        }
        ${Proposal.fragments.ProposalFields}
        ${Scheme.fragments.SchemeFields}
      `
      return context.getObservableList(
        query,
        (r: any) => new Proposal(r, context),
        apolloQueryOptions
      ) as IObservable<Proposal[]>
    } else {
      query = gql`query ProposalSearchPartialData
        {
          proposals ${createGraphQlQuery(options, where)} {
            id
            dao {
              id
            }
            votingMachine
            scheme {
              id
              address
            }
          }
        }
      `
      return context.getObservableList(
        query,
        (r: any) => new Proposal(r.id, context),
        apolloQueryOptions
      ) as IObservable<Proposal[]>
    }
  }

  public context: Arc
  public id: string
  public staticState: IProposalStaticState | undefined
  constructor(
    idOrOpts: string | IProposalStaticState,
    context: Arc
  ) {
    if (typeof idOrOpts === 'string') {
      this.id = idOrOpts
    } else {
      this.id = idOrOpts.id
      this.setStaticState(idOrOpts)
    }
    this.context = context
  }

  public setStaticState(opts: IProposalStaticState) {
    this.staticState = opts
  }

  public async fetchStaticState(): Promise<IProposalStaticState> {
    if (!!this.staticState) {
      return this.staticState
    } else {
      const state = await this.state({ subscribe: false }).pipe(first()).toPromise()
      if (state === null) {
        throw Error(`No proposal with id ${this.id} was found in the subgraph`)
      }
      const staticState = {
        dao: state.dao,
        id: this.id,
        scheme: state.scheme,
        votingMachine: state.votingMachine
      }
      this.setStaticState(staticState)
      return staticState
    }

  }
  /**
   * `state` is an observable of the proposal state
   */
  public state(apolloQueryOptions: IApolloQueryOptions = {}): Observable<IProposalState> {
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
      ${Proposal.fragments.ProposalFields}
      ${Scheme.fragments.SchemeFields}
    `

    const itemMap = (item: any): IProposalState | null => {
      if (item === null || item === undefined) {
        // no proposal was found - we return null
        // throw Error(`No proposal with id ${this.id} could be found`)
        return null
      }

      let contributionReward: ContributionReward.IContributionReward | null = null
      let competition: ICompetitionProposalState | null = null
      let type: IProposalType
      let genericScheme: GenericScheme.IGenericScheme | null = null
      let schemeRegistrar: SchemeRegistrar.ISchemeRegistrar | null = null
      if (!!item.competition && !item.contributionReward) {
        throw Error(`Unexpected proposal state: competition is set, but contributionReward is not`)
      }
      if (!!item.contributionReward) {
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

        type = IProposalType.ContributionReward
        contributionReward = {
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
        if (!!item.competition) {
          competition = {
            admin: item.competition.admin,
            contract: item.competition.contract,
            createdAt: secondSinceEpochToDate(item.competition.createdAt),
            endTime: secondSinceEpochToDate(item.competition.endTime),
            id: item.competition.id,
            numberOfVotesPerVoter: Number(item.competition.numberOfVotesPerVoters),
            numberOfWinners: Number(item.competition.numberOfWinners),
            numberOfWinningSuggestions: Number(item.competition.numberOfWinningSuggestions),
            rewardSplit: item.competition.rewardSplit.map((perc: string) => Number(perc)),
            snapshotBlock: item.competition.snapshotBlock,
            startTime: secondSinceEpochToDate(item.competition.startTime),
            suggestionsEndTime: secondSinceEpochToDate(item.competition.suggestionsEndTime),
            totalSuggestions: Number(item.competition.totalSuggestions),
            totalVotes: Number(item.competition.totalVotes),
            votingStartTime: secondSinceEpochToDate(item.competition.votingStartTime)
          }

        }
      } else if (item.genericScheme) {
        type = IProposalType.GenericScheme
        genericScheme = {
          callData: item.genericScheme.callData,
          contractToCall: item.genericScheme.contractToCall,
          executed: item.genericScheme.executed,
          id: item.genericScheme.id,
          returnValue: item.genericScheme.returnValue
        }
      } else if (item.schemeRegistrar) {
        if (item.schemeRegistrar.schemeToRegister) {
          // TODO: this is failing bc of https://github.com/daostack/subgraph/issues/224
          if (item.dao.schemes.map((s: any) => s.address.toLowerCase())
            .includes(item.schemeRegistrar.schemeToRegister.toLowerCase())) {
            type = IProposalType.SchemeRegistrarEdit
          } else {
            type = IProposalType.SchemeRegistrarAdd
          }
        } else if (item.schemeRegistrar.schemeToRemove) {
          type = IProposalType.SchemeRegistrarRemove
        } else {
          throw Error(`Unknown proposal type: schemeRegistrar without a scheme to register or to remove`)
        }
        schemeRegistrar = {
          decision: item.schemeRegistrar.decision,
          id: item.schemeRegistrar.id,
          schemeRegistered: item.schemeRegistrar.schemeRegistered,
          schemeRemoved: item.schemeRegistrar.schemeRemoved,
          schemeToRegister: item.schemeRegistrar.schemeToRegister,
          schemeToRegisterParamsHash: item.schemeRegistrar.schemeToRegisterParamsHash,
          schemeToRegisterPermission: item.schemeRegistrar.schemeToRegisterPermission,
          schemeToRemove: item.schemeRegistrar.schemeToRemove
        }
      } else {
        throw Error(`Unknown proposal type or incomplete proposal data`)
      }
      // the  formule to enter into the preboosted state is:
      // (S+/S-) > AlphaConstant^NumberOfBoostedProposal.
      // (stakesFor/stakesAgainst) > gpQueue.threshold
      const stage: any = IProposalStage[item.stage]
      const threshold = realMathToNumber(new BN(item.gpQueue.threshold))
      const stakesFor = new BN(item.stakesFor)
      const stakesAgainst = new BN(item.stakesAgainst)

      // upstakeNeededToPreBoost is the amount of tokens needed to upstake to move to the preboost queue
      // this is only non-zero for Queued proposals
      // note that the number can be negative!
      let upstakeNeededToPreBoost: BN = new BN(0)
      const PRECISION = Math.pow(2, 40)
      if (stage === IProposalStage.Queued) {

        upstakeNeededToPreBoost = new BN(threshold * PRECISION)
          .mul(stakesAgainst)
          .div(new BN(PRECISION))
          .sub(stakesFor)
      }
      // upstakeNeededToPreBoost is the amount of tokens needed to upstake to move to the Queued queue
      // this is only non-zero for Preboosted proposals
      // note that the number can be negative!
      let downStakeNeededToQueue: BN = new BN(0)
      if (stage === IProposalStage.PreBoosted) {
        downStakeNeededToQueue = stakesFor.mul(new BN(PRECISION))
          .div(new BN(threshold * PRECISION))
          .sub(stakesAgainst)
      }
      const scheme = item.scheme
      const gpQueue = item.gpQueue

      const schemeState = Scheme.itemMap(scheme, this.context) as ISchemeState
      const queueState: IQueueState = {
        dao: item.dao.id,
        id: gpQueue.id,
        name: schemeState.name,
        scheme: schemeState,
        threshold,
        votingMachine: gpQueue.votingMachine
      }

      return {
        accountsWithUnclaimedRewards: item.accountsWithUnclaimedRewards,
        boostedAt: Number(item.boostedAt),
        closingAt: Number(item.closingAt),
        competition,
        confidenceThreshold: Number(item.confidenceThreshold),
        contributionReward,
        createdAt: Number(item.createdAt),
        dao: new DAO(item.dao.id, this.context),
        description: item.description,
        descriptionHash: item.descriptionHash,
        downStakeNeededToQueue,
        executedAt: Number(item.executedAt),
        executionState: IExecutionState[item.executionState] as any,
        expiresInQueueAt: Number(item.expiresInQueueAt),
        genericScheme,
        genesisProtocolParams: mapGenesisProtocolParams(item.genesisProtocolParams),
        id: item.id,
        organizationId: item.organizationId,
        paramsHash: item.paramsHash,
        preBoostedAt: Number(item.preBoostedAt),
        proposal: this,
        proposer: item.proposer,
        queue: queueState,
        quietEndingPeriodBeganAt: Number(item.quietEndingPeriodBeganAt),
        resolvedAt: item.resolvedAt !== undefined ? Number(item.resolvedAt) : 0,
        scheme: schemeState,
        schemeRegistrar,
        stage,
        stakesAgainst,
        stakesFor,
        tags: item.tags.map((t: any) => t.id),
        title: item.title,
        totalRepWhenCreated: new BN(item.totalRepWhenCreated),
        totalRepWhenExecuted: new BN(item.totalRepWhenExecuted),
        type,
        upstakeNeededToPreBoost,
        url: item.url,
        voteOnBehalf: item.voteOnBehalf,
        votesAgainst: new BN(item.votesAgainst),
        votesCount: item.votes.length,
        votesFor: new BN(item.votesFor),
        votingMachine: item.votingMachine,
        winningOutcome: IProposalOutcome[item.winningOutcome] as any
      }
    }

    const result = this.context.getObservableObject(query, itemMap, apolloQueryOptions) as Observable<IProposalState>
    return result
  }

  /**
   * @return the scheme Contract
   */
  public async scheme() {
    const schemeAddress = (await this.state().pipe(filter((o) => !!o), first()).toPromise()).scheme.address
    return this.context.getContract(schemeAddress)
  }

  /**
   * [votingMachine description]
   * @return a web3 Contract instance
   */
  public async votingMachine() {
    const staticState = await this.fetchStaticState()
    return this.context.getContract(staticState.votingMachine)
  }
  /**
   * [redeemerContract description]
   * @return a web3 Contract instance
   */
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

  public votes(options: IVoteQueryOptions = {}, apolloQueryOptions: IApolloQueryOptions = {}): Observable<Vote[]> {
    if (!options.where) { options.where = {} }
    options.where.proposal = this.id
    return Vote.search(this.context, options, apolloQueryOptions)
  }

  /**
   * Vote for this proposal
   * @param  outcome one of IProposalOutcome.Pass (0) or IProposalOutcome.FAIL (1)
   * @param  amount the amount of reputation to vote with. Defaults to 0 - in that case,
   *  all the sender's rep will be used
   * @return  an observable Operation<Vote>
   */
  public vote(outcome: IProposalOutcome, amount: number = 0): Operation<Vote | null> {

    const mapReceipt = (receipt: ITransactionReceipt) => {
      let args
      try {
        args = getEventArgs(receipt, 'VoteProposal', 'Proposal.vote')
      } catch (e) {
        // no vote was cast
        return null
      }

      return new Vote({
        amount: args[3], // _reputation
        // createdAt is "about now", but we cannot calculate the data that will be indexed by the subgraph
        createdAt: 0, // createdAt -
        outcome,
        proposal: this.id, // proposalID
        voter: args[2] // _vote
      }, this.context)
    }

    const errorHandler = async (error: Error) => {
      const proposal = this
      const votingMachine = await this.votingMachine()
      const proposalDataFromVotingMachine = await votingMachine.proposals(proposal.id)

      if (proposalDataFromVotingMachine.proposer === NULL_ADDRESS) {
        return Error(`Error in vote(): unknown proposal with id ${proposal.id}`)
      }

      if (proposalDataFromVotingMachine.state === '2') {
        const msg = `Error in vote(): proposal ${proposal.id} already executed`
        return Error(msg)
      }

      // if everything seems fine, just return the original error
      return error
    }

    const createTransaction = async (): Promise<ITransaction> => ({
      contract: await this.votingMachine(),
      method: 'vote',
      args: [
        this.id,  // proposalId
        outcome, // a value between 0 to and the proposal number of choices.
        amount.toString(), // amount of reputation to vote with . if _amount == 0 it will use all voter reputation.
        NULL_ADDRESS
      ]
    })

    const observable = from(createTransaction()).pipe(
      concatMap((transaction) => {
        return this.context.sendTransaction(transaction, mapReceipt, errorHandler)
      })
    )

    return toIOperationObservable(observable)
  }

  public stakingToken() {
    return this.context.GENToken()
  }

  public stakes(options: IStakeQueryOptions = {}, apolloQueryOptions: IApolloQueryOptions = {}): Observable<Stake[]> {
    if (!options.where) { options.where = {} }
    options.where.proposal = this.id
    return Stake.search(this.context, options, apolloQueryOptions)
  }

  /**
   * Stake on this proposal
   * @param  outcome the outcome that is staked on, of type IProposalOutcome
   * @param  amount  the amount, in GEN, to stake
   * @return  An observable that can be sent, or subscribed to
   */
  public stake(outcome: IProposalOutcome, amount: BN): Operation<Stake> {

    const mapReceipt = (receipt: ITransactionReceipt) => {

      const args = getEventArgs(receipt, 'Stake', 'Proposal.stake')

      return new Stake({
        amount: args[3], // _amount
        // createdAt is "about now", but we cannot calculate the data that will be indexed by the subgraph
        createdAt: undefined,
        outcome,
        proposal: this.id, // proposalID
        staker: args[2] // _staker
      }, this.context)
    }

    const errorHandler = async (error: Error) => {
      const proposal = this
      const votingMachine = await this.votingMachine()
      const proposalState = await votingMachine.proposals(proposal.id)
      const stakingToken = this.stakingToken()
      if (proposalState.proposer === NULL_ADDRESS) {
        return new Error(`Unknown proposal with id ${proposal.id}`)
      }
      // staker has sufficient balance
      const defaultAccount = await this.context.getAccount().pipe(first()).toPromise()
      const balance = new BN(await stakingToken.contract().balanceOf(defaultAccount))
      const amountBN = new BN(amount)
      if (balance.lt(amountBN)) {
        const msg = `Staker ${defaultAccount} has insufficient balance to stake ${amount.toString()}
          (balance is ${balance.toString()})`
        return new Error(msg)
      }

      // staker has approved the token spend
      const allowance = new BN(await stakingToken.contract().allowance(
        defaultAccount, votingMachine.address
      ))
      if (allowance.lt(amountBN)) {
        return new Error(
          `Staker has insufficient allowance to stake ${amount.toString()}
            (allowance for ${votingMachine.address} is ${allowance.toString()})`
        )
      }

      if (!!error.message.match(/event was found/)) {
        if (proposalState.state === IProposalStage.Boosted) {
          return new Error(`Staking failed because the proposal is boosted`)
        }
      }

      // if we have found no known error, we return the original error
      return error
    }

    const createTransaction = async (): Promise<ITransaction> => ({
      contract: await this.votingMachine(),
      method: 'stake',
      args: [
        this.id,  // proposalId
        outcome, // a value between 0 to and the proposal number of choices.
        amount.toString() // the amount of tokens to stake
      ]
    })

    const observable = from(createTransaction()).pipe(
      concatMap((transaction) => {
        return this.context.sendTransaction(transaction, mapReceipt, errorHandler)
      })
    )

    return toIOperationObservable(observable)
  }

  public rewards(
    options: IRewardQueryOptions = {},
    apolloQueryOptions: IApolloQueryOptions = {}
  ): Observable<Reward[]> {
    if (!options.where) { options.where = {} }
    options.where.proposal = this.id
    return Reward.search(this.context, options, apolloQueryOptions)
  }

  /**
   * [claimRewards description] Execute the proposal and distribute the rewards
   * to the beneficiary.
   * This uses the Redeemer.sol helper contract
   * @param  beneficiary Addresss of the beneficiary, optional,
   *    if undefined will only redeem the ContributionReward rewards
   * @return  an Operation
   */
  public claimRewards(beneficiary?: Address): Operation<boolean> {

    const mapReceipt = (receipt: ITransactionReceipt) => true

    const createTransaction = async (): Promise<ITransaction> => {
      if (!beneficiary) {
        beneficiary = NULL_ADDRESS
      }

      const state = await this.state().pipe(first()).toPromise()
      let schemeAddress: Address | null

      if (state.contributionReward) {
        schemeAddress = state.scheme.address
      } else {
        // if this is not a contributionreard scheme, we can use any scheme address as
        // a dummy placeholder, and the redeem function will still work
        schemeAddress = this.context.getContractInfoByName(
          'ContributionReward', CONTRIBUTION_REWARD_DUMMY_VERSION).address
      }

      let method
      let args
      if (state.scheme.name === 'ContributionRewardExt') {
        method = 'redeemFromCRExt'
        args = [
          schemeAddress, // contributionreward address
          state.votingMachine, // genesisProtocol address
          this.id,
          beneficiary
        ]
      } else {
        method = 'redeem'
        args = [
          schemeAddress, // contributionreward address
          state.votingMachine, // genesisProtocol address
          this.id,
          state.dao.id,
          beneficiary
        ]
      }

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

  /**
   * call the 'execute()' function on the votingMachine.
   * the main purpose of this function is to set the stage of the proposals
   * this call may (or may not) "execute" the proposal itself (i.e. do what the proposal proposes)
   * @return an Operation that, when sucessful, will contain the receipt of the transaction
   */
  public execute(): Operation<undefined> {

    const mapReceipt = (receipt: ITransactionReceipt) => undefined

    const errorHandler = async (err: Error) => {
      const votingMachine = await this.votingMachine()
      const proposalDataFromVotingMachine = await votingMachine.proposals(this.id)

      if (proposalDataFromVotingMachine.callbacks === NULL_ADDRESS) {
        const msg = `Error in proposal.execute(): A proposal with id ${this.id} does not exist`
        return Error(msg)
      } else if (proposalDataFromVotingMachine.state === '2') {
        const msg = `Error in proposal.execute(): proposal ${this.id} already executed`
        return Error(msg)
      }

      return err
    }

    const createTransaction = async (): Promise<ITransaction> => ({
      contract: await this.votingMachine(),
      method: 'execute',
      args: [ this.id ]
    })

    const observable = from(createTransaction()).pipe(
      concatMap((transaction) => {
        return this.context.sendTransaction(transaction, mapReceipt, errorHandler)
      })
    )

    return toIOperationObservable(observable)
  }

  public executeBoosted(): Operation<undefined> {
    const mapReceipt = (receipt: ITransactionReceipt) => undefined

    const errorHandler = async (err: Error) => {
      const votingMachine = await this.votingMachine()
      const proposalDataFromVotingMachine = await votingMachine.proposals(this.id)

      if (proposalDataFromVotingMachine.callbacks === NULL_ADDRESS) {
        const msg = `Error in proposal.executeBoosted(): A proposal with id ${this.id} does not exist`
        return Error(msg)
      }

      return err
    }

    const createTransaction = async (): Promise<ITransaction> => ({
      contract: await this.votingMachine(),
      method: 'executeBoosted',
      args: [ this.id ]
    })

    const observable = from(createTransaction()).pipe(
      concatMap((transaction) => {
        return this.context.sendTransaction(transaction, mapReceipt, errorHandler)
      })
    )

    return toIOperationObservable(observable)
  }

}

enum ProposalQuerySortOptions {
  resolvesAt = 'resolvesAt',
  preBoostedAt = 'preBoostedAt'
}

export interface IProposalQueryOptions extends ICommonQueryOptions {
  where?: {
    accountsWithUnclaimedRewards_contains?: Address[]
    active?: boolean
    boosted?: boolean
    dao?: Address
    expiresInQueueAt?: Date
    expiresInQueueAt_gte?: Date
    expiresInQueueAt_lte?: Date
    expiresInQueueAt_gt?: Date
    executedAfter?: Date
    executedBefore?: Date
    id?: string
    proposer?: Address
    proposalId?: string
    stage?: IProposalStage
    stage_in?: IProposalStage[]
    scheme?: Address
    orderBy?: ProposalQuerySortOptions
    type?: IProposalType
    [key: string]: any | undefined
  }
}

export interface IProposalBaseCreateOptions {
  dao: Address
  description?: string
  descriptionHash?: string
  title?: string
  tags?: string[]
  scheme?: Address
  url?: string
  proposalType?: IProposalType | 'competition'
}

export type IProposalCreateOptions = (
  GenericScheme.IProposalCreateOptionsGS |
  SchemeRegistrar.IProposalCreateOptionsSR |
  ContributionReward.IProposalCreateOptionsCR |
  ContributionRewardExt.IProposalCreateOptionsCRExt |
  IProposalCreateOptionsComp
)
