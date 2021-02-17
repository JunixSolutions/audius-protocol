const path = require('path')
const axios = require('axios')
const ServiceCommands = require('@audius/service-commands')
const { logger } = require('../logger.js')
const {
  addAndUpgradeUsers
} = require('../helpers.js')
// const { exec } = require('child_process')

const DEFAULT_INDEX = 1

/*
const {
  uploadTrack,
  getTrackMetadata,
  getUser,
  verifyCIDExistsOnCreatorNode
} = ServiceCommands
*/

let contentNodeList = null
let contentNodeEndpointToInfoMapping = {}

const {
    getUser
} = ServiceCommands

// const TEMP_STORAGE_PATH = path.resolve('./local-storage/tmp/')
let walletIndexToUserIdMap

const verifyUserReplicaSetStatus = async (
  userId,
  libs
) =>
{
  try {
    // Query user replica set from on chain contract
    let usrReplicaInfoFromContract = await libs.getUserReplicaSet(userId)

    // Query user object
    let usrQueryInfo = await getUser(libs, userId)

    // Deconstruct the comma separated value of enpdoint1,endoint2,endpoint3
    let replicaEndpointArray = usrQueryInfo.creator_node_endpoint.split(",")
    let primaryEndpointString = replicaEndpointArray[0]
    let secondaryEndpointStrings = replicaEndpointArray.slice(1)
    let primaryInfo = contentNodeEndpointToInfoMapping[primaryEndpointString]
    let primaryID = usrQueryInfo.primary_id

    // Throw if mismatch between queried primaryID and assigned 
    //    spID on chain for this endpoint
    if (primaryID !== primaryInfo.spID) {
      throw new Error(`Mismatch spID values. Expected endpoint for ${primaryID}, found ${primaryInfo.spID}`)
    }

    // Throw if mismatch between primaryID from discovery-node and primaryID in UserReplicaSetManager
    if (primaryID !== parseInt(usrReplicaInfoFromContract.primaryId)) {
      throw new Error(`Mismatch primaryID values. Expected ${primaryID}, found ${usrReplicaInfoFromContract.primaryId}`)
    }

    logger.info(`userId: ${userId} Replica Set Info: ${primaryID}, ${usrQueryInfo.secondary_ids}`)
    logger.info(`userId: ${userId} Replica Set String: ${usrQueryInfo.creator_node_endpoint}`)
    logger.info(`userId: ${userId} primaryID: ${primaryID} primaryIdFromEndointStr: ${primaryInfo.spID}`)

    // Throw if array lengths do not match for secondary_ids
    if (secondaryEndpointStrings.length !== usrQueryInfo.secondary_ids.length) {
      throw new Error('Mismatched secondary status')
    }

    // Compare secondary replica ID values
    for (var i = 0; i < usrQueryInfo.secondary_ids.length; i++) {
      let secondaryId = usrQueryInfo.secondary_ids[i]
      let secondaryEndpoint = secondaryEndpointStrings[i]
      let secondaryInfoFromStr = contentNodeEndpointToInfoMapping[secondaryEndpoint]
      let secondaryIdFromStr = secondaryInfoFromStr.spID
      logger.info(`userId: ${userId} secondaryId: ${secondaryId} secondaryIdFromEndpointStr: ${secondaryIdFromStr}`)
      // Throw if the ID array does not match the ID mapped to the 
      // endpoint in the legacy creator_node_endpoint 
      if (secondaryId !== secondaryIdFromStr) {
        throw new Error("Invalid write operation")
      }
      // Throw if mismatch between secondaryId from discovery-node and secondaryId in UserReplicaSetManager
      // Index into the array is taken into account here as well
      if (secondaryId !== parseInt(usrReplicaInfoFromContract.secondaryIds[i])) {
        throw new Error(`Mismatch secondaryId values. Expected ${secondaryId}, found ${usrReplicaInfoFromContract.secondaryIDs[i]}`)
      }
    }
  } catch (e) {
    logger.error(`Error validating userId:${userId} :${e}`)
    throw new Error(e)
  }
}

const getLatestIndexedBlock = async (endpoint) => {
  return (await axios({
    method: 'get',
    baseURL: endpoint,
    url: '/health_check'
  })).data.latest_indexed_block
}

const maxIndexingTimeout = 15000


const waitForBlock = async (libs, targetBlockNumber) => {
  let latestIndexedBlock = await getLatestIndexedBlock(libs.getDiscoveryNodeEndpoint())
  const startTime = Date.now()
  while (Date.now() - startTime < maxIndexingTimeout) {
    latestIndexedBlock = await getLatestIndexedBlock(libs.getDiscoveryNodeEndpoint())
    if (latestIndexedBlock >= targetBlockNumber) {
      logger.info(`Discovery Node has indexed block #${targetBlockNumber}!`)
      return true
    }
  }
  throw new Error(`Failed to reach ${targetBlockNumber} in ${maxIndexingTimeout}`)
}

const verifyUserReplicaSets = async(executeAll) => {
  // Verify replica state after users have been initialized
  await executeAll(async (libs, i) => {
    // Retrieve user id if known from walletIndexToUserIdMap
    // NOTE - It might be easier to just create a map of wallets instead of using 'index'
    const userId = walletIndexToUserIdMap[i]
    await verifyUserReplicaSetStatus(userId, libs) 
  })
}

// Promote each user's secondary1 to primary
// Replica set transitions: (P=Primary, S1=Secondary1, S2 = Secondary2)
// P->S1, S1->P, S2->S2
const promoteSecondary1ToPrimary = async(executeAll) => {
  await executeAll(async (libs, i) => {
    // Retrieve user id if known from walletIndexToUserIdMap
    // NOTE - It might be easier to just create a map of wallets instead of using 'index'
    const userId = walletIndexToUserIdMap[i]
    let usrReplicaInfoFromContract = await libs.getUserReplicaSet(userId)
    logger.info(`userId: ${userId}: promoteSecondary1ToPrimary`)
    let primary = usrReplicaInfoFromContract.primaryId
    let secondaries = usrReplicaInfoFromContract.secondaryIds

    let newPrimary = parseInt(secondaries[0])
    let newSecondaries = [primary, secondaries[1]].map(x=>parseInt(x))
    logger.info(`userId: ${userId} | P: ${primary}->${newPrimary}`)
    logger.info(`userId: ${userId} | S1: ${secondaries[0]}->${newSecondaries[0]}`)
    logger.info(`userId: ${userId} | S2: ${secondaries[1]}->${newSecondaries[1]}`)
    let tx = await libs.updateReplicaSet(userId, newPrimary, newSecondaries)
    await waitForBlock(libs, tx.blockNumber)
  })
}

// Promote each user's secondary2 to primary
// Replica set transitions: (P=Primary, S1=Secondary1, S2 = Secondary2)
// P->S2, S1->S1, S2->P
const promoteSecondary2ToPrimary = async(executeAll) => {
  await executeAll(async (libs, i) => {
    // Retrieve user id if known from walletIndexToUserIdMap
    // NOTE - It might be easier to just create a map of wallets instead of using 'index'
    const userId = walletIndexToUserIdMap[i]
    let usrReplicaInfoFromContract = await libs.getUserReplicaSet(userId)
    logger.info(`userId: ${userId}: promoteSecondary2ToPrimary`)
    let primary = usrReplicaInfoFromContract.primaryId
    let secondaries = usrReplicaInfoFromContract.secondaryIds

    let newPrimary = parseInt(secondaries[1])
    let newSecondaries = [secondaries[0], primary].map(x=>parseInt(x))
    logger.info(`userId: ${userId} | P: ${primary}->${newPrimary}`)
    logger.info(`userId: ${userId} | S1: ${secondaries[0]}->${newSecondaries[0]}`)
    logger.info(`userId: ${userId} | S2: ${secondaries[1]}->${newSecondaries[1]}`)
    let tx = await libs.updateReplicaSet(userId, newPrimary, newSecondaries)
    await waitForBlock(libs, tx.blockNumber)
  })
}

// Promote each user's secondary2 to primary
// Replica set transitions: (P=Primary, S1=Secondary1, S2 = Secondary2)
// P->P, S1->S2, S2->S1
const swapSecondaries = async(executeAll) => {
  await executeAll(async (libs, i) => {
    // Retrieve user id if known from walletIndexToUserIdMap
    // NOTE - It might be easier to just create a map of wallets instead of using 'index'
    const userId = walletIndexToUserIdMap[i]
    let usrReplicaInfoFromContract = await libs.getUserReplicaSet(userId)
    logger.info(`userId: ${userId}: swapSecondaries`)
    let primary = usrReplicaInfoFromContract.primaryId
    let secondaries = usrReplicaInfoFromContract.secondaryIds
    let newPrimary = primary
    let newSecondaries = [secondaries[1], secondaries[0]].map(x=>parseInt(x))
    logger.info(`userId: ${userId} | P: ${primary}->${newPrimary}`)
    logger.info(`userId: ${userId} | S1: ${secondaries[0]}->${newSecondaries[0]}`)
    logger.info(`userId: ${userId} | S2: ${secondaries[1]}->${newSecondaries[1]}`)
    let tx = await libs.updateReplicaSet(userId, newPrimary, newSecondaries)
    await waitForBlock(libs, tx.blockNumber)
  })
}

// Verify indexed state matches content nodes registered in UserReplicaSetManager
// Also confirms UserReplicaSetManager state maches eth-contracts
const verifyUsrmContentNodes = async (executeOne) => {
  logger.info(`Validating content-nodes on UserReplicaSetManager`)
  await executeOne(DEFAULT_INDEX, async (libs)=> {
    let queriedContentNodes = (await axios({
      method: 'get',
      baseURL: libs.getDiscoveryNodeEndpoint(),
      url: '/usrm_content_nodes'
    })).data.data
    await Promise.all(queriedContentNodes.map(async (queriedNodeInfo) => {
      let spID = queriedNodeInfo.cnode_sp_id
      let wallet = queriedNodeInfo.delegate_owner_wallet
      let walletFromChain = await libs.getContentNodeWallet(spID) 
      if (wallet !== walletFromChain) {
        throw new Error(
          `Mismatch between UserReplicaSetManager chain wallet: ${walletFromChain} and queried wallet: ${wallet}`
        )
      }
      // Query eth-contracts and confirm IDs
      logger.info(`Found UserReplicaSetManager and Discovery Provider match for spID=${spID}, delegateWallet=${wallet}`)
      let ethSpInfo = await libs.getServiceEndpointInfo('content-node', spID)
      if (walletFromChain !== ethSpInfo.delegateOwnerWallet) {
        throw new Error(
          `Mismatch between UserReplicaSetManager chain wallet: ${walletFromChain} and SP eth-contracts wallet: ${ethSpInfo.delegateOwnerWallet}`
        )
      }
      logger.info(`Found UserReplicaSetManager and ServiceProviderFactory match for spID=${spID}, delegateWallet=${walletFromChain}`)
    }))
  })
  logger.info(`Finished validating content-nodes on UserReplicaSetManager`)
}

const userReplicaSetManagerTest = async ({
  numUsers,
  executeAll,
  executeOne,
}) => {
  contentNodeEndpointToInfoMapping = {}
  // Initialize users
  if (!walletIndexToUserIdMap) {
    try {
      walletIndexToUserIdMap = await addAndUpgradeUsers(
        numUsers,
        executeAll,
        executeOne
      )
    } catch (e) {
      return { error: `Issue with creating and upgrading users: ${e}` }
    }
  }

  let contentNodeList = await executeOne(DEFAULT_INDEX, async (libsWrapper) => {
    let endpointsList = await libsWrapper.getServices('content-node') 
    return endpointsList
  })
  contentNodeList.forEach((info)=>{
      contentNodeEndpointToInfoMapping[info.endpoint] = info
  })
  
  await verifyUsrmContentNodes(executeOne)
  // Start of actual test logic
  await verifyUserReplicaSets(executeAll)
  await promoteSecondary1ToPrimary(executeAll)
  await verifyUserReplicaSets(executeAll)
  await promoteSecondary2ToPrimary(executeAll)
  await verifyUserReplicaSets(executeAll)
  await swapSecondaries(executeAll)
  await verifyUserReplicaSets(executeAll)
}

module.exports = {
  userReplicaSetManagerTest
}