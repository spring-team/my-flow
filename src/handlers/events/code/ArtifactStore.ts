
import { AppInfo } from "./DeploymentChain";
import * as Stream from "stream";

export interface ArtifactStore {

    /**
     * Returns the URL of a StoredArtifact
     * @param {string} appInfo
     * @param {ReadableStream} what
     * @return {Promise<String>}
     */
    store(appInfo: AppInfo, what: Stream): Promise<string>;

    storeFile(appInfo: AppInfo, localFile: string): Promise<string>;

    retrieve(url: string): Promise<StoredArtifact>;
}

export interface StoredArtifact {

    appInfo: AppInfo;

    deploymentUnitUrl: string;
}
