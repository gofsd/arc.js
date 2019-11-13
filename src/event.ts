import gql from 'graphql-tag'
import { Observable } from 'rxjs'
import { first } from 'rxjs/operators'
import { Arc, IApolloQueryOptions } from './arc'
import { Address, ICommonQueryOptions, IStateful } from './types'
import { createGraphQlQuery, isAddress } from './utils'

export interface IEventStaticState {
  id: string
  dao: string
  proposal: string
  user: string
  data: {[key: string]: any}
  timestamp: string
}

export interface IEventState extends IEventStaticState {
  id: string
}

export interface IEventQueryOptions extends ICommonQueryOptions {
  where?: {
    id?: string,
    dao?: Address,
    proposal?: string,
    user?: Address
    [key: string]: any
  }
}

export class Event implements IStateful<IEventState> {

  public static fragments = {
    EventFields: gql`fragment EventFields on Event {
      id
      dao {
        id
      }
      type
      data
      user
      proposal {
        id
      }
      timestamp
    }`
  }

  /**
   * Event.search(context, options) searches for reward entities
   * @param  context an Arc instance that provides connection information
   * @param  options the query options, cf. IEventQueryOptions
   * @return         an observable of Event objects
   */
  public static search(
    context: Arc,
    options: IEventQueryOptions = {},
    apolloQueryOptions: IApolloQueryOptions = {}
  ): Observable<Event[]> {
    let where = ''
    if (!options.where) { options.where = {}}

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

      if (key === 'dao') {
        const option = options.where[key] as string
        isAddress(option)
        options.where[key] = option.toLowerCase()
      }

      where += `${key}: "${options.where[key] as string}"\n`
    }

    const itemMap = (item: any) => new Event({
      dao: item.dao.id,
      data: JSON.parse(item.data),
      id: item.id,
      proposal: item.proposal && item.proposal.id,
      timestamp: item.timestamp,
      user: item.user
    }, context)

    let query
    query = gql`query EventSearch
      {
        events ${createGraphQlQuery(options, where)} {
          ...EventFields
        }
      }
      ${Event.fragments.EventFields}
      `

    return context.getObservableList(
      query,
      itemMap,
      apolloQueryOptions
    ) as Observable<Event[]>
  }

  public id: string
  public staticState: IEventStaticState | undefined

constructor(public idOrOpts: string | IEventStaticState, public context: Arc) {
    this.context = context
    if (typeof idOrOpts === 'string') {
      this.id = idOrOpts
    } else {
      this.id = idOrOpts.id
      this.setStaticState(idOrOpts as IEventStaticState)
    }
  }

  public state(apolloQueryOptions: IApolloQueryOptions = {}): Observable < IEventState > {

    const query = gql`
      query EventState {
        event (id: "${this.id}")
        {
          ...EventFields
        }
      }
      ${Event.fragments.EventFields}
    `

    const itemMap = (item: any): IEventState => {
      const staticState = {
        dao: item.dao.id,
        data: JSON.parse(item.data),
        id: item.id,
        proposal: item.proposal && item.proposal.id,
        timestamp: item.timestamp,
        user: item.user
      }
      this.setStaticState(staticState)
      return staticState
    }

    return this.context.getObservableObject(query, itemMap, apolloQueryOptions)
  }

  public setStaticState(opts: IEventStaticState) {
    this.staticState = opts
  }

  public async fetchStaticState(): Promise < IEventStaticState > {
    if (!!this.staticState) {
      return this.staticState
    } else {
      const state = await this.state({ subscribe: false }).pipe(first()).toPromise()
      this.setStaticState(state)
      return state
    }
  }

}