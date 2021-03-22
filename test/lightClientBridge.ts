import { expect } from "chai"
import web3 from "web3"
import { ethers, waffle, artifacts } from "hardhat"
import getMerkleTestData, { createMerkleTree } from "./data/merkleTestData"
import { LightClientBridge, MerkleProof, ValidatorRegistry } from "../types"
import { authoritySet0, justificationBlock2 } from "./lightClientBridgeFixtures"
import { signatureSubstratToEthereum } from "../src/utils/signatureSubstratToEthereum"

async function testFixture() {
  const valsMerkleTree = createMerkleTree(authoritySet0.authoritiesEthereum)
  const valsMerkleRoot = valsMerkleTree.getHexRoot()

  const merkleProofFactory = await ethers.getContractFactory("MerkleProof")
  const merkleProofContract = (await merkleProofFactory.deploy()) as MerkleProof
  await merkleProofContract.deployed()

  const validatorRegistryFactory = await ethers.getContractFactory("ValidatorRegistry", {
    libraries: {
      MerkleProof: merkleProofContract.address,
    },
  })
  const validatorRegistryContract = (await validatorRegistryFactory.deploy(
    valsMerkleRoot,
    authoritySet0.authoritiesEthereum.length
  )) as ValidatorRegistry
  await validatorRegistryContract.deployed()

  const lightClientBridgeFactory = await ethers.getContractFactory("LightClientBridge")
  const lightClientBridgeContract = (await lightClientBridgeFactory.deploy(
    validatorRegistryContract.address
  )) as LightClientBridge
  await lightClientBridgeContract.deployed()

  return {
    lightClientBridgeContract,
    validatorRegistryContract,
    vals: authoritySet0.authoritiesEthereum,
    valsMerkleTree,
  }
}

/**
 * Note: We can use Waffle's chai matchers here without explicitly
 * stating `chai.use(solidity)`
 */
describe("LightClientBridge Contract", function () {
  describe("constructor", function () {
    it("Should deploy the contract successfully", async function () {
      const { lightClientBridgeContract } = await testFixture()

      expect(lightClientBridgeContract).to.haveOwnProperty("address")
    })

    it("Should set the validatorRegistry contract correctly", async function () {
      const { lightClientBridgeContract, validatorRegistryContract } = await testFixture()

      expect(await lightClientBridgeContract.validatorRegistry()).to.equal(validatorRegistryContract.address)
    })

    it("currentId should initally be zero", async function () {
      const { lightClientBridgeContract } = await testFixture()

      expect(await lightClientBridgeContract.currentId()).to.equal(0)
    })
  })

  describe("newSignatureCommitment function", function () {
    it("Should not revert when submitting a valid newSignatureCommitment", async function () {
      const { lightClientBridgeContract, validatorRegistryContract, vals, valsMerkleTree } = await testFixture()

      //TODO: Add bitfield stuff properly
      const validatorClaimsBitfield = [1]

      // Get validator leaves and proofs for each leaf
      const leaf0 = valsMerkleTree.getLeaves()[0]
      const val0PubKeyMerkleProof = valsMerkleTree.getHexProof(leaf0)
      const leaf1 = valsMerkleTree.getLeaves()[1]
      const val1PubKeyMerkleProof = valsMerkleTree.getHexProof(leaf1)

      // Confirm validators are in fact part of validator set
      expect(await validatorRegistryContract.checkValidatorInSet(vals[0], 0, val0PubKeyMerkleProof)).to.be.true

      expect(await validatorRegistryContract.checkValidatorInSet(vals[1], 1, val1PubKeyMerkleProof)).to.be.true

      const sig0 = signatureSubstratToEthereum(justificationBlock2.justification.signatures[0])

      const result = lightClientBridgeContract.newSignatureCommitment(
        justificationBlock2.hashedCommitment,
        validatorClaimsBitfield,
        sig0,
        vals[0],
        val0PubKeyMerkleProof
      )

      expect(result).to.not.be.reverted

      expect(result)
        .to.emit(lightClientBridgeContract, "InitialVerificationSuccessful")
        .withArgs((await result).from, (await result).blockNumber, 0)

      expect(await lightClientBridgeContract.currentId()).to.equal(1)

      // TODO add assertion for the stake being locked up (whose stake? signer? or relayer?)
    })

    it("Should revert when validatorPublicKey is not in in validatorRegistry given validatorPublicKeyMerkleProof", async function () {
      const { lightClientBridgeContract, validatorRegistryContract, vals, valsMerkleTree } = await testFixture()

      //TODO: Add bitfield stuff properly
      const validatorClaimsBitfield = [1]

      // Get proof for wrong leaf (wrong authority)
      let leaf0 = valsMerkleTree.getLeaves()[0]
      const leaf0Hex = leaf0.toString("hex").slice(0, -4) + "dead"
      leaf0 = Buffer.from(leaf0Hex, "hex")
      const val0PubKeyMerkleProof = valsMerkleTree.getHexProof(leaf0)

      // Confirm validator proof is indeed wrong
      expect(await validatorRegistryContract.checkValidatorInSet(vals[0], 0, val0PubKeyMerkleProof)).to.be.false

      const sig0 = signatureSubstratToEthereum(justificationBlock2.justification.signatures[0])

      const result = lightClientBridgeContract.newSignatureCommitment(
        justificationBlock2.hashedCommitment,
        validatorClaimsBitfield,
        sig0,
        vals[0] as any,
        val0PubKeyMerkleProof
      )

      expect(result).to.be.reverted

      expect(await lightClientBridgeContract.currentId()).to.equal(0)
    })

    it("Should revert when validatorPublicKey is not in validatorClaimsBitfield")
    it("Should revert when validatorPublicKey is not signer of payload in validatorSignatureCommitment")
    it("Should revert when validatorClaimsBitfield is too short")
  })

  describe("completeSignatureCommitment function", function () {
    it("Should not revert when calling completeSignatureCommitment after newSignatureCommitment", async function () {
      const { lightClientBridgeContract, validatorRegistryContract, vals, valsMerkleTree } = await testFixture()
      const [signer] = await ethers.getSigners()

      // TODO: Add bitfield stuff properly
      const validatorClaimsBitfield = [12]

      // Get validator leaves and proofs for each leaf
      const leaf0 = valsMerkleTree.getLeaves()[0]
      const validatorPublicKeyMerkleProof0 = valsMerkleTree.getHexProof(leaf0)
      const leaf1 = valsMerkleTree.getLeaves()[1]
      const validatorPublicKeyMerkleProof1 = valsMerkleTree.getHexProof(leaf1)

      // Confirm validators are in fact part of validator set
      expect(await validatorRegistryContract.checkValidatorInSet(vals[0], 0, validatorPublicKeyMerkleProof0)).to.be.true

      expect(await validatorRegistryContract.checkValidatorInSet(vals[1], 1, validatorPublicKeyMerkleProof1)).to.be.true

      const sig0 = signatureSubstratToEthereum(justificationBlock2.justification.signatures[0])

      const result = lightClientBridgeContract.newSignatureCommitment(
        justificationBlock2.hashedCommitment,
        validatorClaimsBitfield,
        sig0,
        vals[0] as any,
        validatorPublicKeyMerkleProof0
      )

      expect(result).to.not.be.reverted

      expect(await lightClientBridgeContract.currentId()).to.equal(1)

      //TODO Generate randomSignatureBitfieldPositions properly
      const randomSignatureBitfieldPositions: string[] = []

      // TODO Populate randomSignerAddresses and randomPublicKeyMerkleProofs and randomSignatureCommitments
      // based on randomSignatureBitfieldPositions required
      const randomValidatorAddresses: string[] = vals
      const randomPublicKeyMerkleProofs: string[][] = []
      const randomSignatureCommitments: string[] = justificationBlock2.justification.signatures

      const validationDataID = 0
      const completionResult = lightClientBridgeContract.completeSignatureCommitment(
        validationDataID,
        justificationBlock2.hashedCommitment,
        randomSignatureCommitments,
        randomSignatureBitfieldPositions,
        randomValidatorAddresses,
        randomPublicKeyMerkleProofs
      )
      expect(completionResult).to.not.be.reverted

      expect(completionResult)
        .to.emit(lightClientBridgeContract, "FinalVerificationSuccessful")
        .withArgs(
          (await completionResult).from,
          "0x01edc5e9703f9a95a6611f6d07de73fd787730240d16a7f1f232ada977bef2ab",
          0
        )

      expect(await lightClientBridgeContract.currentId()).to.equal(1)

      // TODO add assertion for the stake being refunded

      // TODO add assertion for processPayload being called
    })

    it("Should revert when random signature positions are different (different bitfield)")
    it(
      "Should revert when a signature is randomly provided that was not in the validatorClaimsBitField when newSignatureCommitment was called"
    )
    it("Should revert when a randomValidatorAddresses is not in in validatorRegistry given randomPublicKeyMerkleProofs")
    it("Should revert when a randomValidatorAddresses is not signer of payload in randomSignatureCommitments")
    it("Should revert when payload is not for the current validator set") // TODO is that not covered above? Do we need other test cases here?
    it("Should revert when payload is older than latest committed one") // TODO is that not covered above? Do we need other test cases here?
    it("Should revert when payload is not for a previous epoch") // TODO is that not covered above? Do we need other test cases here?
    it("Should revert when payload is not for the next epoch but has no validator set changes") // TODO is that not covered above? Do we need other test cases here?
    it("Should revert when payload is not for a future epoch after the next") // TODO is that not covered above? Do we need other test cases here?

    context("validator set changes", function () {
      it("should correctly call the method to update the validator set of validatorRegistry")
    })
  })
})
