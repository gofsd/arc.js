import { getMainDefinition } from 'apollo-utilities'
import gql from 'graphql-tag'
import { first } from 'rxjs/operators'
import { Address, IProposalOutcome, Member, Proposal, Scheme, Stake } from '../src'
import { createApolloClient } from '../src/graphnode'
import { Vote } from '../src/vote'
import { createAProposal, graphqlHttpProvider, graphqlWsProvider, newArc, waitUntilTrue } from './utils'

jest.setTimeout(20000)
/**
 * Tests to see if the apollo cache works as expected
 */
describe('apolloClient caching checks', () => {

  let arc: any
  let networkSubscriptions: any[] = []
  let networkQueries: any[] = []

  beforeEach(async () => {
    networkSubscriptions = []
    networkQueries = []
    arc = await newArc({
      graphqlHttpProvider,
      graphqlWsProvider,
      ipfsProvider: '',
      web3Provider: 'ws://127.0.0.1:8545'

    })

    arc.apolloClient = createApolloClient({
      graphqlHttpProvider,
      graphqlWsProvider,
      graphqlPrefetchHook: (query: any) => {
        const definition = getMainDefinition(query)
        // console.log(query)
        // @ts-ignore
        if (definition.operation === 'subscription') {
          networkSubscriptions.push(definition)
        } else {
          networkQueries.push(definition)
        }
        // console.log(definition)
      }
    })
  })

  it('pre-fetching DAOs works', async () => {
    // const client = arc.apolloClient
    // get all DAOs
    const daos = await arc.daos().pipe(first()).toPromise()

    // we will still hit the server when getting the DAO state, because the previous query did not fetch all state data
    // so the next line with 'cache-only' will throw an Error
    const p = arc.dao(daos[0].id).state({ fetchPolicy: 'cache-only'}).pipe(first()).toPromise()
    expect(p).rejects.toThrow()

    // now get all the DAOs with defailed data
    await arc.daos({}, { fetchAllData: true }).pipe(first()).toPromise()
    // now we have all data in the cache - and we can get the whole state from the cache without error
    await arc.dao(daos[0].id).state({ fetchPolicy: 'cache-only'}).pipe(first()).toPromise()
  })

  it('pre-fetching Proposals works', async () => {

    const proposals = await Proposal.search(arc).pipe(first()).toPromise()
    const proposal = proposals[0]
    // so the next line with 'cache-only' will throw an Error
    const p = proposal.state({ fetchPolicy: 'cache-only'}).pipe(first()).toPromise()
    expect(p).rejects.toThrow()

    // now get all the DAOs with defailed data
    await Proposal.search(arc, {}, { fetchAllData: true }).pipe(first()).toPromise()
    // now we have all data in the cache - and we can get the whole state from the cache without error
    await proposal.state({ fetchPolicy: 'cache-only'}).pipe(first()).toPromise()
  })

  it('pre-fetching Members with Member.search() works', async () => {

    // get all members of the dao
    const members = await Member.search(arc).pipe(first()).toPromise()
    const member = members[0]

    // we will still hit the server when getting the DAO state, because the previous query did not fetch all state data
    // so the next line with 'cache-only' will throw an Error
    expect(member.id).toBeTruthy()
    // await new Member(member.id as string , arc).state().pipe(first()).toPromise()
    await new Member(member.id as string , arc).state({ fetchPolicy: 'cache-only'}).pipe(first()).toPromise()
  })

  it('pre-fetching ProposalVotes works', async () => {
    // find a proposal in a scheme that has > 1 votes
    let proposals = await Proposal.search(arc, {}, { fetchAllData: true }).pipe(first()).toPromise()
    // @ts-ignore
    proposals = proposals.filter((p) => p.staticState.votes.length > 1)
    const proposal = proposals[0]
    // @ts-ignore
    const vote = new Vote(proposals[0].staticState.votes[0], arc)
    const voteState = await vote.state().pipe(first()).toPromise()
    const voterAddress = voteState.voter
    const proposalState = await proposal.state().pipe(first()).toPromise()
    const scheme = new Scheme(proposalState.scheme.id, arc)

    // now we have our objects, reset the cache
    await arc.apolloClient.cache.reset()
    expect(arc.apolloClient.cache.data.data).toEqual({})

    // construct our superquery
    const query = gql`query {
      proposals (where: { scheme: "${scheme.id}"}){
        ...ProposalFields
        stakes { id }
        votes (where: { voter: "${voterAddress}"}) {
          ...VoteFields
          }
        }
      }
      ${Proposal.fragments.ProposalFields}
      ${Vote.fragments.VoteFields}
    `
    let subscribed = false
    const results: any[] = []
    arc.getObservable(query, { subscribe: true, fetchPolicy: 'no-cache'}).subscribe((x: any) => {
      subscribed = true
      results.push(x)
    })
    await waitUntilTrue(() => subscribed)
    const proposalData = await proposal.state().pipe(first()).toPromise()
    expect(proposalData.scheme.id).toEqual(scheme.id)
    const proposalVotes = await proposal.votes({ where: { voter: voterAddress}}, { fetchPolicy: 'cache-only'})
      .pipe(first()).toPromise()
    expect(proposalVotes.map((v: Vote) => v.id)).toEqual([vote.id])
  })

  it.skip('pre-fetching ProposalStakes works', async () => {
    // create a proposal with 2 stakes to test with
    const proposal = await createAProposal()

    const accounts = arc.web3.eth.accounts.wallet
    async function approveAndStake(address: Address) {
      arc.setAccount(address)
      const stakingToken =  await proposal.stakingToken()
      // approve the spend, for staking
      const votingMachine = await proposal.votingMachine()
      await stakingToken.approveForStaking(votingMachine.options.address, 100).send()
      await proposal.stake(IProposalOutcome.Pass, 100).send()
    }
    await approveAndStake(accounts[0].address)
    await approveAndStake(accounts[1].address)
    await approveAndStake(accounts[2].address)

    // this proposal should have some stakes now
    console.log(proposal.id)
    const stakes = await proposal.stakes({}, {fetchPolicy: 'no-cache'}).pipe(first()).toPromise()
    expect(stakes.length).toBeGreaterThan(1)
    const stake = stakes[0]
    const stakeState = await stake.state().pipe(first()).toPromise()
    const stakerAddress = stakeState.staker
    const proposalState = await proposal.state({ fetchPolicy: 'no-cache'}).pipe(first()).toPromise()
    const scheme = new Scheme(proposalState.scheme.id, arc)
    // now we have our objects, reset the cache
    await arc.apolloClient.cache.reset()
    expect(arc.apolloClient.cache.data.data).toEqual({})

    // construct our superquery
    const query = gql`query {
      proposals (where: { scheme: "${scheme.id}"}){
        ...ProposalFields
        votes {
          id
        }
        stakes (where: { staker: "${stakerAddress}"}) {
          ...StakeFields
          }
        }
      }
      ${Proposal.fragments.ProposalFields}
      ${Stake.fragments.StakeFields}
    `
    let subscribed = false
    //
    const data: any[] = []
    arc.getObservable(query, { subscribe: true }).subscribe((x: any) => {
      data.push(x)
      subscribed = true
    })
    await waitUntilTrue(() => subscribed)

    // we now get all proposal data without hitting the cache
    // const proposalData = await proposal.state({ fetchPolicy: 'cache-only'}).pipe(first()).toPromise()
    // expect(proposalData.scheme.id).toEqual(scheme.id)
    //
    const proposalStakes = await proposal.stakes({ where: { staker: stakerAddress}}, { fetchPolicy: 'cache-only'})
      .pipe(first()).toPromise()
    // @ts-ignore
    console.log(proposalStakes[0].staticState.staker)
    console.log(stakerAddress)
    expect(proposalStakes.map((v: Stake) => v.id)).toEqual([stake.id])

  })

  it('pre-fetching ProposalRewards works [TODO]', async () => {
    console.log('implement this')
  })

  it('pre-fetching Members with dao.members() works', async () => {

    expect(networkSubscriptions.length).toEqual(0)
    expect(networkQueries.length).toEqual(0)
    const daos = await arc.daos({}, { subscribe: false, fetchAllData: true}).pipe(first()).toPromise()
    expect(networkSubscriptions.length).toEqual(0)
    expect(networkQueries.length).toEqual(1)
    const dao = daos[0]
    expect(dao.staticState).toBeTruthy()

    const members = await dao.members({}, {subscribe: false}).pipe(first()).toPromise()
    // we now should have sent a subscriptino for dao.members()

    const member = members[1]
    // subscribe to all (well, the first 100) members and member changes
    await dao.members({}, {subscribe: true }).subscribe()
    expect(networkQueries.length).toEqual(2)
    expect(networkSubscriptions.length).toEqual(1)
    // if we now get the member state, we should not be sending any query at all
    await member.state({ fetchPolicy: 'cache-only', subscribe: false}).subscribe()
    expect(networkQueries.length).toEqual(2)
    expect(networkSubscriptions.length).toEqual(1)
    await member.state({ subscribe: false}).subscribe()
    expect(networkQueries.length).toEqual(2)
    expect(networkSubscriptions.length).toEqual(1)

    // TODO: dieally, we would also be smart enough to not subscribe to an individaul state if we
    // are already subscribed ...
    // await member.state().subscribe()
    // expect(networkQueries.length).toEqual(2)
    // expect(networkSubscriptions.length).toEqual(1)

    // for sanity, check fi we actually ahve the member info
    const memberState = await member.state({fetchPolicy: 'cache-only', subscribe: false}).pipe(first()).toPromise()
    expect(memberState.reputation.isZero()).toBeFalsy()
    // getting the member by address does not open a new subscription either
    await dao.member(memberState.address).state({ subscribe: false}).pipe(first()).toPromise()
    expect(networkQueries.length).toEqual(2)
    expect(networkSubscriptions.length).toEqual(1)

  })
})
