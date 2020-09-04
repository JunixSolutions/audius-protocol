const Utils = require('../../utils')
const GovernedContractClient = require('../contracts/GovernedContractClient')
const DEFAULT_GAS_AMOUNT = 1000000

class DelegateManagerClient extends GovernedContractClient {
  constructor(
    ethWeb3Manager,
    contractABI,
    contractRegistryKey,
    getRegistryAddress,
    audiusTokenClient,
    stakingProxyClient,
    governanceClient
  ) {
    super(ethWeb3Manager, contractABI, contractRegistryKey, getRegistryAddress, governanceClient)
    this.audiusTokenClient = audiusTokenClient
    this.stakingProxyClient = stakingProxyClient
  }


  // @return Updated total amount delegated to the service provider by delegator
  async delegateStake (targetSP, amount) {

    // Approve token transfer operation
    const contractAddress = await this.stakingProxyClient.getAddress()
    let tx0 = await this.audiusTokenClient.approve(
      contractAddress,
      amount)
    const method = await this.getMethod(
      'delegateStake',
      targetSP,
      amount
    )
    const tx = await this.web3Manager.sendTransaction(
      method,
      DEFAULT_GAS_AMOUNT
    )
    return {
      txReceipt: tx,
      tokenApproveReceipt: tx0,
      delegator: tx.events.IncreaseDelegatedStake.returnValues._delegator,
      serviceProvider: tx.events.IncreaseDelegatedStake.returnValues._serviceProvider,
      increaseAmount: Utils.toBN(tx.events.IncreaseDelegatedStake.returnValues._increaseAmount)
    }
  }

  // @return Updated total amount delegated to the service provider by delegator
  async requestUndelegateStake (targetSP, amount) {
    const method = await this.getMethod(
      'requestUndelegateStake',
      targetSP,
      amount
    )
    return this.web3Manager.sendTransaction(
      method,
      DEFAULT_GAS_AMOUNT
    )
  }

  async cancelUndelegateStake () {
    const method = await this.getMethod(
      'cancelUndelegateStake'
    )
    return this.web3Manager.sendTransaction(
      method,
      DEFAULT_GAS_AMOUNT
    )
  }

  // * @return New total amount currently staked after stake has been undelegated
  async undelegateStake () {
    const method = await this.getMethod(
      'undelegateStake'
    )

    const tx = await this.web3Manager.sendTransaction(
      method,
      DEFAULT_GAS_AMOUNT
    )

    return {
      txReceipt: tx,
      delegator: tx.events.DecreaseDelegatedStake.returnValues._delegator,
      serviceProvider: tx.events.DecreaseDelegatedStake.returnValues._serviceProvider,
      decreaseAmount: Utils.toBN(tx.events.DecreaseDelegatedStake.returnValues._decreaseAmount)
    }
  }

  async claimRewards (serviceProvider) {
    const method = await this.getMethod(
      'claimRewards',
      serviceProvider
    )
    return this.web3Manager.sendTransaction(
      method,
      DEFAULT_GAS_AMOUNT
    )
  }
  
  async requestRemoveDelegator (serviceProvider, delegator) {
    const method = await this.getMethod(
      'requestRemoveDelegator',
      serviceProvider,
      delegator
    )
    return this.web3Manager.sendTransaction(
      method,
      DEFAULT_GAS_AMOUNT
    )
  }
  
  async cancelRemoveDelegator (serviceProvider, delegator) {
    const method = await this.getMethod(
      'cancelRemoveDelegator',
      serviceProvider,
      delegator
    )
    return this.web3Manager.sendTransaction(
      method,
      DEFAULT_GAS_AMOUNT
    )
  }
  
  // * @return Updated total amount delegated to the service provider by delegator
  async removeDelegator (serviceProvider, delegator) {
    const method = await this.getMethod(
      'removeDelegator',
      serviceProvider,
      delegator
    )
    const tx = await this.web3Manager.sendTransaction(
      method,
      DEFAULT_GAS_AMOUNT
    )
    return {
      txReceipt: tx,
      delegator: tx.events.DelegatorRemoved.returnValues._delegator,
      serviceProvider: tx.events.DelegatorRemoved.returnValues._serviceProvider,
      unstakedAmount: Utils.toBN(tx.events.DelegatorRemoved.returnValues._unstakedAmount)
    }
  }

  // ========================================= View Functions =========================================

  async getDelegatorsList (serviceProvider) {
    const method = await this.getMethod(
      'getDelegatorsList',
      serviceProvider
    )
    let info = await method.call()
    return info
  }

  async getTotalDelegatedToServiceProvider (serviceProvider) {
    const method = await this.getMethod(
      'getTotalDelegatedToServiceProvider',
      serviceProvider
    )
    let info = await method.call()
    return Utils.toBN(info)
  }

  async getTotalLockedDelegationForServiceProvider (serviceProvider) {
    const method = await this.getMethod(
      'getTotalLockedDelegationForServiceProvider',
      serviceProvider
    )
    let info = await method.call()
    return Utils.toBN(info)
  }

  async getDelegatorStakeForServiceProvider (delegator, serviceProvider) {
    const method = await this.getMethod(
      'getDelegatorStakeForServiceProvider',
      delegator,
      serviceProvider
    )
    let info = await method.call()
    return Utils.toBN(info)
  }

  async getPendingUndelegateRequest (delegator) {
    const method = await this.getMethod(
      'getPendingUndelegateRequest',
      delegator
    )
    let info = await method.call()
    return {
      amount: Utils.toBN(info.amount),
      lockupExpiryBlock: parseInt(info.lockupExpiryBlock),
      target: info.target
    }
  }

  // * @return - current lockup expiry block for remove delegator request
  async getPendingRemoveDelegatorRequest (serviceProvider, delegator) {
    const method = await this.getMethod(
      'getPendingRemoveDelegatorRequest',
      serviceProvider,
      delegator
    )
    let info = await method.call()
    return parseInt(info)
  }

  async getUndelegateLockupDuration () {
    const method = await this.getMethod(
      'getUndelegateLockupDuration',
    )
    let info = await method.call()
    return parseInt(info)
  }
  

  async getMaxDelegators () {
    const method = await this.getMethod(
      'getMaxDelegators',
    )
    let info = await method.call()
    return parseInt(info)
  }
  

  async getMinDelegationAmount () {
    const method = await this.getMethod(
      'getMinDelegationAmount',
    )
    let info = await method.call()
    return Utils.toBN(info)
  }

  async getRemoveDelegatorLockupDuration () {
    const method = await this.getMethod(
      'getRemoveDelegatorLockupDuration',
    )
    let info = await method.call()
    return parseInt(info)
  }

  async getRemoveDelegatorEvalDuration () {
    const method = await this.getMethod(
      'getRemoveDelegatorEvalDuration',
    )
    let info = await method.call()
    return parseInt(info)
  }

  async getGovernanceAddress () {
    const method = await this.getMethod(
      'getGovernanceAddress',
    )
    let info = await method.call()
    return info
  }

  async getServiceProviderFactoryAddress () {
    const method = await this.getMethod(
      'getServiceProviderFactoryAddress',
    )
    let info = await method.call()
    return info
  }

  async getClaimsManagerAddress () {
    const method = await this.getMethod(
      'getClaimsManagerAddress',
    )
    let info = await method.call()
    return info
  }

  async getStakingAddress () {
    const method = await this.getMethod(
      'getStakingAddress',
    )
    let info = await method.call()
    return info
  }

  async updateRemoveDelegatorLockupDuration (duration) {
    const method = await this.getGovernedMethod(
      'updateRemoveDelegatorLockupDuration',
      duration
    )
    return this.web3Manager.sendTransaction(
      method,
      DEFAULT_GAS_AMOUNT
    )
  }

  async updateUndelegateLockupDuration (duration) {
    const method = await this.getGovernedMethod(
      'updateUndelegateLockupDuration',
      duration
    )
    return this.web3Manager.sendTransaction(
      method,
      DEFAULT_GAS_AMOUNT
    )
  }
}

module.exports = DelegateManagerClient
