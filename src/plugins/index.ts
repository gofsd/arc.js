import { GenericScheme } from "./genericScheme/plugin"
import { SchemeRegistrar } from "./schemeRegistrar/plugin"
import { GenericSchemeProposal } from "./genericScheme/proposal"
import { SchemeRegistrarProposal, SchemeRegistrarProposalTypes} from "./schemeRegistrar/proposal"
import { ContributionRewardProposal } from "./contributionReward/proposal"
import { CompetitionProposal } from "./competition/proposal"
import { ContributionRewardExtProposal } from "./contributionRewardExt/proposal"
import { ContributionReward } from './contributionReward/plugin'
import { ContributionRewardExt } from "./contributionRewardExt/plugin"
import { Competition } from "./competition/plugin"
import { Proposal, IProposalState, IProposalBaseCreateOptions } from "./proposal"
import { Plugin, IPluginState } from "./plugin"
import { ProposalPlugin } from "./proposalPlugin"

export const Plugins = {
  GenericScheme,
  SchemeRegistrar,
  ContributionReward,
  ContributionRewardExt,
  Competition
}

export const Proposals = {
  GenericScheme: GenericSchemeProposal,
  SchemeRegistrar: SchemeRegistrarProposal,
  ContributionReward: ContributionRewardProposal,
  Competition: CompetitionProposal,
  ContributionRewardExt: ContributionRewardExtProposal
}

export type PluginName = keyof typeof Plugins
export type ProposalName = keyof typeof Proposals

export type ProposalTypeNames = keyof typeof Proposals | SchemeRegistrarProposalTypes

export type AnyProposal = Proposal<IProposalState>
export type AnyPlugin = Plugin<IPluginState>
export type AnyProposalPlugin = ProposalPlugin<IPluginState, IProposalState, IProposalBaseCreateOptions>

export * from './plugin'
export * from './proposal'
export * from './proposalPlugin'
export * from './competition'
export * from './contributionReward'
export * from './contributionRewardExt'
export * from './genericScheme'
export * from './schemeRegistrar'
export * from './reputationFromToken'