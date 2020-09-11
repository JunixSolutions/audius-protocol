const Utils = require("../../utils")
const GovernedContractClient = require('../contracts/GovernedContractClient')
const DEFAULT_GAS_AMOUNT = 1000000

class ClaimsManagerClient extends GovernedContractClient {
  /* ------- GETTERS ------- */

  // Get the duration of a funding round in blocks
  async getFundingRoundBlockDiff () {
    const method = await this.getMethod(
      'getFundingRoundBlockDiff'
    )
    const info = await method.call()
    return parseInt(info)
  }

  // Get the last block where a funding round was initiated
  async getLastFundedBlock () {
    const method = await this.getMethod(
      'getLastFundedBlock'
    )
    const info = await method.call()
    return parseInt(info)
  }

  // Get the amount funded per round in wei
  async getFundsPerRound () {
    const method = await this.getMethod(
      'getFundsPerRound'
    )
    const info = await method.call()
    return Utils.toBN(info)
  }

  // Get the total amount claimed in the current round
  async getTotalClaimedInRound () {
    const method = await this.getMethod(
      'getTotalClaimedInRound'
    )
    const info = await method.call()
    return Utils.toBN(info)
  }

  // Get the Governance address
  async getGovernanceAddress () {
    const method = await this.getMethod(
      'getGovernanceAddress'
    )
    const info = await method.call()
    return info
  }

  // Get the ServiceProviderFactory address
  async getServiceProviderFactoryAddress () {
    const method = await this.getMethod(
      'getServiceProviderFactoryAddress'
    )
    const info = await method.call()
    return info
  }

  // Get the DelegateManager address
  async getDelegateManagerAddress () {
    const method = await this.getMethod(
      'getDelegateManagerAddress'
    )
    const info = await method.call()
    return info
  }

  // Get the Staking address
  async getStakingAddress () {
    const method = await this.getMethod(
      'getStakingAddress'
    )
    const info = await method.call()
    return info
  }

  // Returns boolean indicating whether a claim is considered pending
  async claimPending (address) {
    const method = await this.getMethod(
      'claimPending',
      address
    )
    const info = await method.call()
    return info
  }


  // Returns boolean indicating whether a claim is considered pending
  async initiateRound () {
    const method = await this.getMethod(
      'initiateRound'
    )
    return this.web3Manager.sendTransaction(
      method,
      DEFAULT_GAS_AMOUNT
    )
  }
}

module.exports = ClaimsManagerClient
