import { expect } from 'chai';
import { Signer } from 'ethers';
import { ethers } from 'hardhat';
import Contracts from '../../components/Contracts';
import { SchemaRegistry, TestEAS, TestERC20Token } from '../../typechain-types';
import { NO_EXPIRATION } from '../../utils/Constants';
import { expectAttestation, expectFailedAttestation, registerSchema } from '../helpers/EAS';
import { latest } from '../helpers/Time';
import { createWallet } from '../helpers/Wallet';

describe('SelfVerifyingResolver', () => {
  let accounts: Signer[];
  let recipient: Signer;
  let sender: Signer;

  let registry: SchemaRegistry;
  let eas: TestEAS;
  let token: TestERC20Token;

  const schema = 'address target,bytes callData,bytes32 expected';
  let schemaId: string;
  const expirationTime = NO_EXPIRATION;

  const encodeData = (target: string, callData: string, expected: string) =>
    ethers.AbiCoder.defaultAbiCoder().encode(['address', 'bytes', 'bytes32'], [target, callData, expected]);

  const claimOf = (value: bigint) => ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [value]));

  before(async () => {
    accounts = await ethers.getSigners();

    [recipient] = accounts;
  });

  beforeEach(async () => {
    sender = await createWallet();

    registry = await Contracts.SchemaRegistry.deploy();
    eas = await Contracts.TestEAS.deploy(await registry.getAddress());

    await eas.setTime(await latest());

    // A test target whose public on-chain state an attestation will claim a value from.
    token = await Contracts.TestERC20Token.deploy('TKN', 'TKN', 1_000_000);

    const resolver = await Contracts.SelfVerifyingResolver.deploy(await eas.getAddress());
    expect(await resolver.isPayable()).to.be.false;

    schemaId = await registerSchema(schema, registry, resolver, true);
  });

  it('should allow attesting a claim that matches the recomputed on-chain value', async () => {
    const holder = await recipient.getAddress();
    const callData = token.interface.encodeFunctionData('balanceOf', [holder]);
    const balance = await token.balanceOf(holder);

    const { uid } = await expectAttestation(
      { eas },
      schemaId,
      {
        recipient: holder,
        expirationTime,
        data: encodeData(await token.getAddress(), callData, claimOf(balance))
      },
      { from: sender }
    );

    expect(uid).to.not.equal(ethers.ZeroHash);
  });

  it('should revert when the claimed outcome does not match the recomputed value', async () => {
    const holder = await recipient.getAddress();
    const callData = token.interface.encodeFunctionData('balanceOf', [holder]);

    await expectFailedAttestation(
      { eas },
      schemaId,
      {
        recipient: holder,
        expirationTime,
        data: encodeData(await token.getAddress(), callData, claimOf(1n))
      },
      { from: sender },
      'InvalidAttestation'
    );
  });

  it('should revert when the read is not decidable and the target reverts', async () => {
    const holder = await recipient.getAddress();
    // An unknown selector on the token reverts, so the outcome is undecidable and is rejected, not guessed.
    const badCallData = '0xdeadbeef';

    await expectFailedAttestation(
      { eas },
      schemaId,
      {
        recipient: holder,
        expirationTime,
        data: encodeData(await token.getAddress(), badCallData, claimOf(0n))
      },
      { from: sender },
      'InvalidAttestation'
    );
  });
});
