import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const rps = await deploy("RPS", {
    from: deployer,
    log: true,
    args: [],
  });
  const rpsClub = await deploy("RPSClub", {
    from: deployer,
    log: true,
    args: [process.env.URI ?? "uri://", rps.address],
  });

  console.log(`rpsClub contract: `, rpsClub.address);
};
export default func;
func.id = "deploy_RPSClub"; // id required to prevent reexecution
func.tags = ["RPSClub"];
