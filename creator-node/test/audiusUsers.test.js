const request = require('supertest')
const assert = require('assert')
const sinon = require('sinon')
const fs = require('fs')

const models = require('../src/models')

const ipfsClient = require('../src/ipfsClient')
const config = require('../src/config')
const BlacklistManager = require('../src/blacklistManager')
const DiskManager = require('../src/diskManager')

const { getApp } = require('./lib/app')
const { createStarterCNodeUser } = require('./lib/dataSeeds')
const { getIPFSMock } = require('./lib/ipfsMock')
const { getLibsMock } = require('./lib/libsMock')
const { sortKeys } = require('../src/apiSigning')

describe('test AudiusUsers with mocked IPFS', function () {
  let app, server, session, ipfsMock, libsMock

  // Will need a '.' in front of storagePath to look at current dir
  // a '/' will search the root dir
  before(async () => {
    const originalStoragePath = config.get('storagePath')
    if (originalStoragePath.slice(0, 1) === '/') {
      const updatedStoragePath = '.' + originalStoragePath
      config.set('storagePath', updatedStoragePath)
    }
  })

  beforeEach(async () => {
    ipfsMock = getIPFSMock()
    libsMock = getLibsMock()

    const appInfo = await getApp(ipfsMock, libsMock, BlacklistManager)
    await BlacklistManager.init()

    app = appInfo.app
    server = appInfo.server
    session = await createStarterCNodeUser()
  })

  afterEach(async () => {
    sinon.restore()
    await server.close()
  })

  it('successfully creates Audius user (POST /audius_users/metadata)', async function () {
    const metadata = { test: 'field1' }
    ipfsMock.add.twice().withArgs(Buffer.from(JSON.stringify(metadata)))
    ipfsMock.pin.add.once().withArgs('QmYfSQCgCwhxwYcdEwCkFJHicDe6rzCAb7AtLz3GrHmuU6')

    const resp = await request(app)
      .post('/audius_users/metadata')
      .set('X-Session-ID', session.sessionToken)
      .send({ metadata })
      .expect(200)

    if (resp.body.data.metadataMultihash !== 'QmYfSQCgCwhxwYcdEwCkFJHicDe6rzCAb7AtLz3GrHmuU6' || !resp.body.data.metadataFileUUID) {
      throw new Error('invalid return data')
    }
  })

  it('successfully completes Audius user creation (POST /audius_users/metadata -> POST /audius_users)', async function () {
    const metadata = { test: 'field1' }

    ipfsMock.add.twice().withArgs(Buffer.from(JSON.stringify(metadata)))
    ipfsMock.pin.add.once().withArgs('QmYfSQCgCwhxwYcdEwCkFJHicDe6rzCAb7AtLz3GrHmuU6')
    libsMock.User.getUsers.exactly(2)

    const resp = await request(app)
      .post('/audius_users/metadata')
      .set('X-Session-ID', session.sessionToken)
      .send({ metadata })
      .expect(200)

    if (resp.body.data.metadataMultihash !== 'QmYfSQCgCwhxwYcdEwCkFJHicDe6rzCAb7AtLz3GrHmuU6') {
      throw new Error('invalid return data')
    }

    await request(app)
      .post('/audius_users')
      .set('X-Session-ID', session.sessionToken)
      .send({ blockchainUserId: 1, blockNumber: 10, metadataFileUUID: resp.body.data.metadataFileUUID })
      .expect(200)
  })
})

// Below block uses actual ipfsClient (unlike first describe block), hence
// another describe block for this purpose
// NOTE: these tests mock ipfs client errors; otherwise, for happy path, uses actual ipfsClient
describe('Test AudiusUsers with real IPFS', function () {
  let app, server, session, libsMock, ipfs

  // Will need a '.' in front of storagePath to look at current dir
  // a '/' will search the root dir
  before(async () => {
    let storagePath = config.get('storagePath')
    if (storagePath.startsWith('/')) {
      storagePath = '.' + storagePath
      config.set('storagePath', storagePath)
    }
  })

  beforeEach(async () => {
    ipfs = ipfsClient.ipfs
    libsMock = getLibsMock()

    const appInfo = await getApp(ipfs, libsMock, BlacklistManager)
    await BlacklistManager.init()

    app = appInfo.app
    server = appInfo.server
    session = await createStarterCNodeUser()
  })

  afterEach(async () => {
    sinon.restore()
    await server.close()
  })

  it('should fail if metadata is not found in request body', async function () {
    const resp = await request(app)
      .post('/audius_users/metadata')
      .set('X-Session-ID', session.sessionToken)
      .send({ dummy: 'data' })
      .expect(500)

    // Route will throw error at `Buffer.from(JSON.stringify(metadataJSON))`
    assert.deepStrictEqual(resp.body.error, 'Internal server error')
  })

  it('should throw error response if saving metadata fails', async function () {
    sinon.stub(ipfs, 'add').rejects(new Error('ipfs add failed!'))

    const metadata = { metadata: 'spaghetti' }
    const resp = await request(app)
      .post('/audius_users/metadata')
      .set('X-Session-ID', session.sessionToken)
      .send(metadata)
      .expect(500)

    assert.deepStrictEqual(resp.body.error, 'saveFileFromBufferToIPFSAndDisk op failed: Error: ipfs add failed!')
  })

  it('successfully creates Audius user (POST /audius_users/metadata)', async function () {
    const metadata = sortKeys({ spaghetti: 'spaghetti' })
    const resp = await request(app)
      .post('/audius_users/metadata')
      .set('X-Session-ID', session.sessionToken)
      .send({ metadata })
      .expect(200)

    // check that the metadata file was written to storagePath under its multihash
    const metadataPath = DiskManager.computeFilePath(resp.body.data.metadataMultihash)
    assert.ok(fs.existsSync(metadataPath))

    // check that the metadata file contents match the metadata specified
    let metadataFileData = fs.readFileSync(metadataPath, 'utf-8')
    metadataFileData = sortKeys(JSON.parse(metadataFileData))
    assert.deepStrictEqual(metadataFileData, metadata)

    // check that the correct metadata file properties were written to db
    const file = await models.File.findOne({ where: {
      multihash: resp.body.data.metadataMultihash,
      storagePath: metadataPath,
      type: 'metadata'
    } })
    assert.ok(file)

    // check that the metadata file is in IPFS
    let ipfsResp
    try {
      ipfsResp = await ipfs.cat(resp.body.data.metadataMultihash)
    } catch (e) {
      // If CID is not present, will throw timeout error
      assert.fail(e.message)
    }

    // check that the ipfs content matches what we expect
    const metadataBuffer = Buffer.from(JSON.stringify(metadata))
    assert.deepStrictEqual(metadataBuffer.compare(ipfsResp), 0)
  })

  it('TODO - successfully completes Audius user creation (POST /audius_users/metadata -> POST /audius_users)', async function () {

  })

  it('TODO - multiple uploads', async function () {

  })
})
