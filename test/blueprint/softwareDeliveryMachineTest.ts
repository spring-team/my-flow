import "mocha";
import * as assert from "power-assert";
import { SoftwareDeliveryMachine, SoftwareDeliveryMachineOptions } from "../../src/blueprint/SoftwareDeliveryMachine";
import { whenPushSatisfies } from "../../src/blueprint/dsl/goalDsl";
import { AnyPush } from "../../src/common/listener/support/pushtest/commonPushTests";
import { AutofixGoal } from "../../src/common/delivery/goals/common/commonGoals";
import { Goals } from "../../src/common/delivery/goals/Goals";
import { determineGoals } from "../../src/handlers/events/delivery/goals/SetGoalsOnPush";
import { SingleProjectLoader } from "../common/SingleProjectLoader";
import { InMemoryProject } from "@atomist/automation-client/project/mem/InMemoryProject";
import { GitHubRepoRef } from "@atomist/automation-client/operations/common/GitHubRepoRef";
import { ProjectOperationCredentials } from "@atomist/automation-client/operations/common/ProjectOperationCredentials";
import { HandlerContext } from "@atomist/automation-client";
import { PushFields } from "../../src/typings/types";

const favoriteRepoRef = GitHubRepoRef.from({
    owner: "jess",
    repo: "monet",
    sha: "75132357b19889c4d6c2bef99fce8f477e1f2196",
    branch: "claude"
});
const fakeSoftwareDeliveryMachineOptions = {
    projectLoader: new SingleProjectLoader(InMemoryProject.from(favoriteRepoRef,
        {path: "README.md", content: "read sometthing else"}))
} as any as SoftwareDeliveryMachineOptions;

const credentials: ProjectOperationCredentials = {token: "ab123bbbaaa"};

const fakeContext = {context: {name: "my favorite context "}} as any as HandlerContext;

const aPush = {} as PushFields.Fragment;

describe("implementing goals in the SDM", () => {

    it("I can teach it to do an autofix", async () => {

        const mySDM = new SoftwareDeliveryMachine("Gustave",
            fakeSoftwareDeliveryMachineOptions,
            whenPushSatisfies(AnyPush)
                .itMeans("autofix the crap out of that thing")
                .setGoals(new Goals("Autofix only", AutofixGoal)));

        const {determinedGoals, goalsToSave} = await determineGoals({
                projectLoader: fakeSoftwareDeliveryMachineOptions.projectLoader,
                goalSetters: mySDM.goalSetters
            }, {
                credentials, id: favoriteRepoRef, context: fakeContext, push: aPush,
                providerId: "josh", addressChannels: () => Promise.resolve({}),
            }
        );

        assert(determinedGoals.goals.includes(AutofixGoal));

    });


});