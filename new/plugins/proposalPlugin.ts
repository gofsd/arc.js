import { Proposal, IProposalQueryOptions } from "../proposal/proposal"
import { IApolloQueryOptions } from "../types";
import { Observable } from "rxjs";
import { Operation, toIOperationObservable, ITransaction, transactionErrorHandler, transactionResultHandler } from "../operation";
import { Plugin } from './plugin'

export abstract class ProposalPlugin<TProposal, TProposalOptions, TPlugin, TPluginParams> extends Plugin<TPluginParams> {

  public createProposal(options: TProposalOptions): Operation<TProposal>  {
    const observable = Observable.create(async (observer: any) => {
      try {
        const createTransaction = await this.createProposalTransaction(options)
        const map = this.createProposalTransactionMap()
        const errHandler = this.createProposalErrorHandler(options)
        const sendTransactionObservable = this.context.sendTransaction(
          createTransaction, map, errHandler
        )
        const sub = sendTransactionObservable.subscribe(observer)
        return () => sub.unsubscribe()
      } catch (e) {
        observer.error(e)
        return
      }
    })

    return toIOperationObservable(observable)
  }

  protected abstract async createProposalTransaction(
    options: TProposalOptions
  ): Promise<ITransaction>

  protected abstract createProposalTransactionMap(): transactionResultHandler<Proposal<TPlugin>>

  protected abstract createProposalErrorHandler(
    options: TProposalOptions
  ): transactionErrorHandler

  public abstract proposals(
    options: IProposalQueryOptions,
    apolloQueryOptions: IApolloQueryOptions
  ): Observable <Proposal<TPlugin>[]>
}