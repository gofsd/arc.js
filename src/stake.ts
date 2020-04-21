import BN from 'bn.js'
import gql from 'graphql-tag'
import { Observable } from 'rxjs'
import {
  Arc,
  IApolloQueryOptions,
  IProposalOutcome,
  createGraphQlQuery,
  isAddress,
  Entity,
  IEntityRef,
  Proposals,
  AnyProposal,
  Address,
  ICommonQueryOptions
} from './index'
import { DocumentNode } from 'graphql'

export interface IStakeState {
  id: string
  staker: Address
  createdAt: Date | undefined
  outcome: IProposalOutcome
  amount: BN // amount staked
  //TODO: Any type of proposal?
  proposal: IEntityRef<AnyProposal>
}

export interface IStakeQueryOptions extends ICommonQueryOptions {
  where?: {
    id?: string
    staker?: Address
    dao?: Address
    proposal?: string
    createdAt?: number
    [key: string]: any
  }
}

export class Stake extends Entity<IStakeState> {
  public static fragments = {
    StakeFields: gql`fragment StakeFields on ProposalStake {
      id
      createdAt
      dao {
        id
      }
      staker
      proposal {
        id
        scheme {
          name
        }
      }
      outcome
      amount
    }`
  }

  public static search(
    context: Arc,
    options: IStakeQueryOptions = {},
    apolloQueryOptions: IApolloQueryOptions = {}
  ): Observable <Stake[]> {
    if (!options.where) { options.where = {}}
    let where = ''

    const proposalId = options.where.proposal
    // if we are searching for stakes on a specific proposal (a common case), we
    // will structure the query so that stakes are stored in the cache together wit the proposal
    if (proposalId) {
      delete options.where.proposal
    }

    for (const key of Object.keys(options.where)) {
      if (options.where[key] === undefined) {
        continue
      }

      if (key === 'staker' || key === 'dao') {
        const option = options.where[key] as string
        isAddress(option)
        options.where[key] = option.toLowerCase()
      }

      where += `${key}: "${options.where[key] as string}"\n`
    }

    let query: DocumentNode

    if (proposalId && !options.where.id) {
      query = gql`query ProposalStakesSearchFromProposal
        {
          proposal (id: "${proposalId}") {
            id
            scheme {
              name
            }
            stakes ${createGraphQlQuery(options, where)} {
              ...StakeFields
            }
          }
        }
        ${Stake.fragments.StakeFields}
      `

      return context.getObservableObject(
        context,
        query,
        (context: Arc, r: any, query: DocumentNode) => {
          if (r === null) { // no such proposal was found
            return []
          }
          const stakes = r.stakes
          const itemMap = (item: any) => Stake.itemMap(context, item, query)
          return stakes.map(itemMap)
        },
        apolloQueryOptions
      ) as Observable<Stake[]>
    } else {
      query = gql`query ProposalStakesSearch
        {
          proposalStakes ${createGraphQlQuery(options, where)} {
              ...StakeFields
          }
        }
        ${Stake.fragments.StakeFields}
      `

      return context.getObservableList(
        context,
        query,
        Stake.itemMap,
        apolloQueryOptions
      ) as Observable<Stake[]>
    }
  }

  public static itemMap = (context: Arc, item: any, query: DocumentNode): IStakeState => {
    if (item === null) {
      throw Error(`Stake ItemMap failed. Query: ${query.loc?.source.body}`)
    }

    let outcome: IProposalOutcome = IProposalOutcome.Pass
    if (item.outcome === 'Pass') {
      outcome = IProposalOutcome.Pass
    } else if (item.outcome === 'Fail') {
      outcome = IProposalOutcome.Fail
    } else {
      throw new Error(`Unexpected value for proposalStakes.outcome: ${item.outcome}`)
    }

    return {
      amount: new BN(item.amount),
      createdAt: item.createdAt,
      id: item.id,
      outcome,
      proposal: {
        id: item.proposal.id,
        entity: new Proposals[item.proposal.scheme.name](context, item.proposal.id)
      },
      staker: item.staker
    }
    
  }

  public state(apolloQueryOptions: IApolloQueryOptions = {}): Observable<IStakeState> {
    const query = gql`query StakeState
      {
        proposalStake (id: "${this.id}") {
          id
          createdAt
          staker
          proposal {
            id
          }
          outcome
          amount
        }
      }
    `

    return this.context.getObservableObject(this.context, query, Stake.itemMap, apolloQueryOptions)
  }
}
