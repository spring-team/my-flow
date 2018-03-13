import { ProjectOperationCredentials } from "@atomist/automation-client/operations/common/ProjectOperationCredentials";
import { DeployableArtifact } from "../artifact/ArtifactStore";
import { LogInterpretation } from "../log/InterpretedLog";
import { ProgressLog } from "../log/ProgressLog";
import { Deployment, TargetInfo, } from "./Deployment";

export interface ArtifactDeployer<T extends TargetInfo = TargetInfo> extends LogInterpretation {

    /**
     * Implemented by deployers that don't sit on an infrastructure like Cloud Foundry
     * or Kubernetes that handles rolling update
     * @return {Promise<any>}
     */
    undeploy?(id: T): Promise<any>;

    deploy(da: DeployableArtifact,
           ti: T,
           log: ProgressLog,
           creds: ProjectOperationCredentials,
           team: string): Promise<Deployment>;

}
