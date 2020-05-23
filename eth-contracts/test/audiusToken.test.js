import * as _lib from '../utils/lib.js'

const tokenRegKey = web3.utils.utf8ToHex('Token')

contract('AudiusToken', async (accounts) => {
  let registry, token, governance

  // expected initial token values
  const NAME = "TestAudius"
  const SYMBOL = "TAUDS"
  const DECIMALS = 18  // standard - imitates relationship between Ether and Wei
  const INITIAL_SUPPLY = Math.pow(10,27) // 10^27 = 1 billion tokens, 18 decimal places

  // intentionally not using acct0 to make sure no TX accidentally succeeds without specifying sender
  const [, proxyAdminAddress, proxyDeployerAddress] = accounts
  const tokenOwnerAddress = proxyDeployerAddress
  const guardianAddress = proxyDeployerAddress

  const votingPeriod = 10
  const votingQuorum = 1
  
  const callValue0 = _lib.toBN(0)

  beforeEach(async () => {
    registry = await _lib.deployRegistry(artifacts, proxyAdminAddress, proxyDeployerAddress)
    governance = await _lib.deployGovernance(
      artifacts,
      proxyAdminAddress,
      proxyDeployerAddress,
      registry,
      votingPeriod,
      votingQuorum,
      guardianAddress
    )

    token = await _lib.deployToken(
      artifacts,
      proxyAdminAddress,
      proxyDeployerAddress,
      tokenOwnerAddress,
      governance.address
    )

    // Register token
    await registry.addContract(tokenRegKey, token.address, { from: proxyDeployerAddress })
  })

  it('Initial token properties', async () => {
    assert.equal(await token.name(), NAME)
    assert.equal(await token.symbol(), SYMBOL)
    assert.equal(await token.decimals(), DECIMALS)
    assert.equal(await token.totalSupply(), INITIAL_SUPPLY)
  })

  it('initial account balances', async () => {
    assert.equal(await token.balanceOf(tokenOwnerAddress), INITIAL_SUPPLY)
    assert.equal(await token.balanceOf(accounts[11]), 0)
  })

  it('Transfers', async () => {
    const amount = 1000
    // transfer
    await token.transfer(accounts[11], amount, {from: tokenOwnerAddress})
    assert.equal(await token.balanceOf(tokenOwnerAddress), INITIAL_SUPPLY - amount)
    assert.equal(await token.balanceOf(accounts[11]), amount)

    // fail to transfer above balance
    await _lib.assertRevert(
      token.transfer(accounts[12], 2*amount, {from: accounts[11]}),
      'transfer amount exceeds balance' 
    )
  })

  it('Burn from treasury', async () => {
    const burnAmount = Math.pow(10,3)

    // Confirm token state before burn
    assert.equal(await token.balanceOf(tokenOwnerAddress), INITIAL_SUPPLY)
    assert.equal(await token.totalSupply(), INITIAL_SUPPLY)

    // Decrease total supply by burning from treasury
    await token.burn(burnAmount, { from: tokenOwnerAddress })

    // Confirm token state after burn
    assert.equal(await token.balanceOf(tokenOwnerAddress), INITIAL_SUPPLY - burnAmount)
    assert.equal(await token.totalSupply(), INITIAL_SUPPLY - burnAmount)
  })

  it('Burn from account', async () => {
    const amount = Math.pow(10,3)
    const account = accounts[11]

    // Confirm token state before burn
    await token.transfer(account, amount, {from: tokenOwnerAddress})
    assert.equal(await token.balanceOf(tokenOwnerAddress), INITIAL_SUPPLY - amount)
    assert.equal(await token.balanceOf(account), amount)
    assert.equal(await token.totalSupply(), INITIAL_SUPPLY)
    
    // Decrease total supply by burning from account
    await token.approve(tokenOwnerAddress, amount, { from: account })
    await token.burnFrom(account, amount, { from: tokenOwnerAddress })

    // Confirm token state after burn
    assert.equal(await token.balanceOf(tokenOwnerAddress), INITIAL_SUPPLY - amount)
    assert.equal(await token.balanceOf(account), 0)
    assert.equal(await token.totalSupply(), INITIAL_SUPPLY - amount)
  })

  it('Mint', async () => {
    // Confirm that only governance has minterRole
    assert.isTrue(await token.isMinter.call(governance.address))
    assert.isFalse(await token.isMinter.call(tokenOwnerAddress))

    // Confirm that mint from tokenOwnerAddress fails
    await _lib.assertRevert(
      token.mint(accounts[11], 1000, { from: tokenOwnerAddress }),
      "MinterRole: caller does not have the Minter role"
    )

    // mint tokens from governance
    const mintTxR = await governance.guardianExecuteTransaction(
      tokenRegKey,
      callValue0,
      'mint(address,uint256)',
      _lib.abiEncode(['address', 'uint256'], [accounts[11], 1000]),
      { from: guardianAddress }
    )
    assert.isTrue(_lib.parseTx(mintTxR).event.args.success, 'Expected tx to succeed')

    // Confirm state after mint
    assert.equal(await token.balanceOf(tokenOwnerAddress), INITIAL_SUPPLY)
    assert.equal(await token.balanceOf(accounts[11]), 1000)
    assert.equal(await token.totalSupply(), INITIAL_SUPPLY + 1000)

    // Confirm that addMinter from tokenOwnerAddress fails
    await _lib.assertRevert(
      token.addMinter(accounts[12], { from: tokenOwnerAddress }),
      "MinterRole: caller does not have the Minter role"
    )

    // add new minter from governance
    const addMinterTxR = await governance.guardianExecuteTransaction(
      tokenRegKey,
      callValue0,
      'addMinter(address)',
      _lib.abiEncode(['address'], [accounts[12]]),
      { from: guardianAddress }
    )
    assert.isTrue(_lib.parseTx(addMinterTxR).event.args.success, 'Expected tx to succeed')

    // Confirm minter state
    assert.isTrue(await token.isMinter(accounts[12]))
    assert.isTrue(await token.isMinter(governance.address))
    assert.isFalse(await token.isMinter(accounts[3]))

    // Confirm that new minter can mint
    await token.mint(accounts[12], 1000, {from: accounts[12]})

    // renounce minter
    await token.renounceMinter({from: accounts[12] })

    // fail to mint from renounced minter
    await _lib.assertRevert(
      token.mint(accounts[4], 1000, { from: accounts[12] }),
      "MinterRole: caller does not have the Minter role"
    )
  })

  it('Pause', async () => {
    // confirm that only governance has pauserRole
    assert.isTrue(await token.isPauser.call(governance.address))
    assert.isFalse(await token.isPauser.call(tokenOwnerAddress))

    // Confirm that pause from tokenOwnerAddress fails
    await _lib.assertRevert(
      token.pause({ from: tokenOwnerAddress }),
      "PauserRole: caller does not have the Pauser role"
    )

    // Pause token contract from governance
    const pauseTxR = await governance.guardianExecuteTransaction(
      tokenRegKey,
      callValue0,
      'pause()',
      _lib.abiEncode([], []),
      { from: guardianAddress }
    )
    assert.isTrue(_lib.parseTx(pauseTxR).event.args.success, 'Expected tx to succeed')

    // Confirm state after pause
    assert.isTrue(await token.paused.call())

    // Confirm that token actions fail while paused
    await _lib.assertRevert(
      token.transfer(accounts[11], 1000, {from: tokenOwnerAddress}),
      "Pausable: paused"
    )

    // Add new pauser from governance
    const newPauser = accounts[5]
    const addPauserTxR = await governance.guardianExecuteTransaction(
      tokenRegKey,
      callValue0,
      'addPauser(address)',
      _lib.abiEncode(['address'], [newPauser]),
      { from: guardianAddress }
    )
    assert.isTrue(_lib.parseTx(addPauserTxR).event.args.success, 'Expected tx to succeed')

    // Confirm pauser state
    assert.isFalse(await token.isPauser(tokenOwnerAddress))
    assert.isTrue(await token.isPauser.call(governance.address))
    assert.isTrue(await token.isPauser(newPauser))

    // Unpause contract from new pauser
    await token.unpause({from: newPauser})
    assert.isFalse(await token.paused())

    // fail to pause contract from non-pauser
    await _lib.assertRevert(
      token.pause({from: accounts[8]}),
      "PauserRole: caller does not have the Pauser role"
    )

    // Renounce pauser from new pauser
    await token.renouncePauser({from: newPauser})
    assert.isFalse(await token.isPauser(newPauser))
    assert.isTrue(await token.isPauser(governance.address))

    // fail to pause contract from renounced pauser
    await _lib.assertRevert(
      token.pause({ from: newPauser }),
      "PauserRole: caller does not have the Pauser role"
    )
  })
})
