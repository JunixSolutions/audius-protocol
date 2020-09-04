const Utils = require('../../utils')
const GovernedContractClient = require('../contracts/GovernedContractClient')
const axios = require('axios')
const { range } = require('lodash')

const DEFAULT_GAS_AMOUNT = 200000

let urlJoin = require('proper-url-join')
if (urlJoin && urlJoin.default) urlJoin = urlJoin.default

class ServiceProviderFactoryClient extends GovernedContractClient {
  constructor(
    ethWeb3Manager,
    contractABI,
    contractRegistryKey,
    getRegistryAddress,
    audiusTokenClient,
    stakingProxyClient,
    governanceClient,
    isDebug = false
  ) {
    super(ethWeb3Manager, contractABI, contractRegistryKey, getRegistryAddress, governanceClient)
    this.audiusTokenClient = audiusTokenClient
    this.stakingProxyClient = stakingProxyClient
    this.isDebug = isDebug
  }

  async registerWithDelegate(serviceType, endpoint, amount, delegateOwnerWallet) {
    if (!this.isDebug && !Utils.isFQDN(endpoint)) {
      throw new Error('Not a fully qualified domain name!')
    }
    if (!Number.isInteger(amount) && !Utils.isBN(amount)) {
      throw new Error('Invalid amount')
    }

    // let requestUrl = urlJoin(endpoint, 'health_check')
    // let axiosRequestObj = {
    //   url: requestUrl,
    //   method: 'get',
    //   timeout: 1000
    // }
    // const resp = await axios(axiosRequestObj)
    // let endpointServiceType
    // try {
    //   endpointServiceType = resp.data.data.service
    // } catch (e) {
    //   endpointServiceType = resp.data.service
    // }

    // if (serviceType !== endpointServiceType) {
    //   throw new Error('Attempting to register endpoint with mismatched service type')
    // }

    // Approve token transfer operation
    const contractAddress = await this.stakingProxyClient.getAddress()
    let tx0 = await this.audiusTokenClient.approve(
      contractAddress,
      amount
    )

    // Register and stake
    console.log('register to vote')
    let method = await this.getMethod('register',
      Utils.utf8ToHex(serviceType),
      endpoint,
      amount,
      delegateOwnerWallet)
    let tx = await this.web3Manager.sendTransaction(method, 1000000)
    console.log('I voted––')
    return {
      txReceipt: tx,
      spID: parseInt(tx.events.RegisteredServiceProvider.returnValues._spID),
      serviceType: Utils.hexToUtf8(tx.events.RegisteredServiceProvider.returnValues._serviceType),
      owner: tx.events.RegisteredServiceProvider.returnValues._owner,
      endpoint: tx.events.RegisteredServiceProvider.returnValues._endpoint,
      // tokenApproveReceipt: tx0
    }
  }

  async register(serviceType, endpoint, amount) {
    return this.registerWithDelegate(
      serviceType,
      endpoint,
      amount,
      this.web3Manager.getWalletAddress())
  }

  async increaseStake(amount) {
    const contractAddress = await this.stakingProxyClient.getAddress()
    let tx0 = await this.audiusTokenClient.approve(
      contractAddress,
      amount
    )
    let method = await this.getMethod('increaseStake', amount)
    let tx = await this.web3Manager.sendTransaction(method, 1000000)
    return {
      txReceipt: tx,
      tokenApproveReceipt: tx0
    }
  }

  /**
   * Makes a request to decrease stake
   * @param {BN} amount
   * @returns decrease stake lockup expiry block
   */
  async requestDecreaseStake(amount) {
    const requestDecreaseMethod = await this.getMethod('requestDecreaseStake', amount)
    await this.web3Manager.sendTransaction(
      requestDecreaseMethod,
      1000000
    )

    const account = this.web3Manager.getWalletAddress()
    const lockupExpiryBlock = await this.getLockupExpiry(account)
    return parseInt(lockupExpiryBlock)
  }

  /**
   * Gets the pending decrease stake request for a given account
   * @param {string} account wallet address to fetch for
   */
  async getPendingDecreaseStakeRequest(account) {
    const requestInfoMethod = await this.getMethod('getPendingDecreaseStakeRequest', account)
    const {
      amount,
      lockupExpiryBlock
    } = await requestInfoMethod.call()
    return { amount,  lockupExpiryBlock }
  }

  /**
   * Fetches the pending decrease stake lockup expiry block for a user
   * @param {string} account wallet address to fetch for
   */
  async getLockupExpiry(account) {
    const { lockupExpiryBlock } = await this.getPendingDecreaseStakeRequest(account)
    return parseInt(lockupExpiryBlock)
  }

 async decreaseStake() {
    const method = await this.getMethod('decreaseStake')
    const tx = await this.web3Manager.sendTransaction(method, 1000000)

    return {
      txReceipt: tx
    }
  }

  /**
   * Deregisters a service
   * @param {string} serviceType
   * @param {string} endpoint
   */
  async deregister(serviceType, endpoint) {
    let method = await this.getMethod('deregister',
      Utils.utf8ToHex(serviceType),
      endpoint)
    let tx = await this.web3Manager.sendTransaction(method)
    return {
      txReceipt: tx,
      spID: parseInt(tx.events.DeregisteredServiceProvider.returnValues._spID),
      serviceType: Utils.hexToUtf8(tx.events.DeregisteredServiceProvider.returnValues._serviceType),
      owner: tx.events.DeregisteredServiceProvider.returnValues._owner,
      endpoint: tx.events.DeregisteredServiceProvider.returnValues._endpoint
    }
  }

  async getTotalServiceTypeProviders(serviceType) {
    const method = await this.getMethod('getTotalServiceTypeProviders',
      Utils.utf8ToHex(serviceType)
    )
    const count = await method.call()
    return parseInt(count)
  }

  async getServiceProviderIdFromEndpoint(endpoint) {
    const method = await this.getMethod('getServiceProviderIdFromEndpoint',
      (endpoint)
    )
    let info = await method.call()
    return parseInt(info)
  }

  // TODO: Remove this method after all consumers are using
  // `getServiceEndpointInfo` directly
  async getServiceProviderInfo(serviceType, serviceId) {
    return this.getServiceEndpointInfo(serviceType, serviceId)
  }

  async getServiceEndpointInfo(serviceType, serviceId) {
    const method = await this.getMethod('getServiceEndpointInfo',
      Utils.utf8ToHex(serviceType),
      serviceId
    )
    let info = await method.call()
    return {
      owner: info.owner,
      endpoint: info.endpoint,
      spID: parseInt(serviceId),
      type: serviceType,
      blockNumber: parseInt(info.blockNumber),
      delegateOwnerWallet: info.delegateOwnerWallet
    }
  }

  async getServiceProviderInfoFromEndpoint(endpoint) {
    // let requestUrl = urlJoin(endpoint, 'health_check')
    // let axiosRequestObj = {
    //   url: requestUrl,
    //   method: 'get',
    //   timeout: 1000
    // }

    // const resp = await axios(axiosRequestObj)
    let serviceType = 'discovery-provider'
    // try {
    //   serviceType = resp.data.data.service
    // } catch (e) {
    //   serviceType = resp.data.service
    // }

    let serviceProviderId = await this.getServiceProviderIdFromEndpoint(endpoint)
    let info = await this.getServiceEndpointInfo(serviceType, serviceProviderId)
    return info
  }

  async getServiceProviderIdsFromAddress(ownerAddress, serviceType) {
    const method = await this.getMethod('getServiceProviderIdsFromAddress',
      ownerAddress,
      Utils.utf8ToHex(serviceType)
    )
    let info = await method.call()
    return info.map(id => parseInt(id))
  }

  async getServiceProviderIdFromAddress(ownerAddress, serviceType) {
    const infos = await this.getServiceProviderIdsFromAddress(ownerAddress, serviceType)
    return infos[0] ? parseInt(infos[0]) : null
  }

  async getServiceEndpointInfoFromAddress(ownerAddress, serviceType) {
    let spId = await this.getServiceProviderIdFromAddress(ownerAddress, serviceType)

    // cast this as an array for backwards compatibility because everything expects an array
    const spInfo = [await this.getServiceEndpointInfo(serviceType, spId)]
    return spInfo
  }

  async getServiceProviderList(serviceType) {
    let numberOfProviders = await this.getTotalServiceTypeProviders(serviceType)

    const providerList = await Promise.all(
      range(1, numberOfProviders + 1).map(i =>
        this.getServiceEndpointInfo(serviceType, i)
      )
    )
    return providerList.filter(provider => provider.endpoint !== '')
  }

  async updateDecreaseStakeLockupDuration(duration) {
    const method = await this.getGovernedMethod(
      'updateDecreaseStakeLockupDuration',
      duration
    )
    return this.web3Manager.sendTransaction(
      method,
      DEFAULT_GAS_AMOUNT
    )
  }

  async getServiceProviderDetails(serviceProviderAddress) {
    const method = await this.getMethod(
      'getServiceProviderDetails',
      serviceProviderAddress
    )
    let info = await method.call()
    return {
      deployerCut: parseInt(info.deployerCut),
      deployerStake: Utils.toBN(info.deployerStake),
      maxAccountStake: Utils.toBN(info.maxAccountStake),
      minAccountStake: Utils.toBN(info.minAccountStake),
      numberOfEndpoints: parseInt(info.numberOfEndpoints),
      validBounds: info.validBounds
    }
  }


  async updateDelegateOwnerWallet(serviceType, endpoint, updatedDelegateOwnerWallet) {
    const method = await this.getMethod(
      'updateDelegateOwnerWallet',
      Utils.utf8ToHex(serviceType),
      endpoint,
      updatedDelegateOwnerWallet
    )

    let tx = await this.web3Manager.sendTransaction(method, DEFAULT_GAS_AMOUNT)
    return tx
  }

  async updateEndpoint(serviceType, oldEndpoint, newEndpoint) {
    const method = await this.getMethod(
      'updateEndpoint',
      Utils.utf8ToHex(serviceType),
      oldEndpoint,
      newEndpoint
    )
    let tx = await this.web3Manager.sendTransaction(method, DEFAULT_GAS_AMOUNT)
    return tx
  }

  async requestUpdateDeployerCut(ownerAddress, deployerCut) {
    const method = await this.getMethod(
      'requestUpdateDeployerCut',
      ownerAddress,
      deployerCut
    )
    let tx = await this.web3Manager.sendTransaction(method, DEFAULT_GAS_AMOUNT)
    return tx
  }

  async getPendingUpdateDeployerCutRequest(ownerAddress) {
    const method = await this.getMethod(
      'getPendingUpdateDeployerCutRequest',
      ownerAddress
    )
    const { lockupExpiryBlock, newDeployerCut } = await method.call()
    return { lockupExpiryBlock: parseInt(lockupExpiryBlock), newDeployerCut: parseInt(newDeployerCut) }
  }

  async cancelUpdateDeployerCut(ownerAddress) {
    const method = await this.getMethod(
      'cancelUpdateDeployerCut',
      ownerAddress
    )
    let tx = await this.web3Manager.sendTransaction(method, DEFAULT_GAS_AMOUNT)
    return tx
  }

  async updateDeployerCut(ownerAddress) {
    const method = await this.getMethod(
      'updateDeployerCut',
      ownerAddress
    )
    let tx = await this.web3Manager.sendTransaction(method, DEFAULT_GAS_AMOUNT)
    return tx
  }

  async updateServiceProviderStake(ownerAddress, newAmount) {
    const method = await this.getMethod(
      'updateServiceProviderStake',
      ownerAddress,
      newAmount
    )
    let tx = await this.web3Manager.sendTransaction(method, DEFAULT_GAS_AMOUNT)
    return tx
  }

}

module.exports = ServiceProviderFactoryClient
