/*
 * Copyright © 2018 Atomist, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Configuration, HandleCommand, HandleEvent, logger } from "@atomist/automation-client";
import { Maker } from "@atomist/automation-client/util/constructionUtils";
import * as _ from "lodash";
import { SdmGoalImplementationMapperImpl } from "../../api-helper/goal/SdmGoalImplementationMapperImpl";
import { addWellKnownGoals } from "../../api-helper/machine/addWellKnownGoals";
import { ListenerRegistrationManagerSupport } from "../../api-helper/machine/ListenerRegistrationManagerSupport";
import { RegistrationManagerSupport } from "../../api-helper/machine/RegistrationManagerSupport";
import { enrichGoalSetters } from "../../api/dsl/goalContribution";
import { ExecuteGoalWithLog } from "../../api/goal/ExecuteGoalWithLog";
import { Goal } from "../../api/goal/Goal";
import { Goals } from "../../api/goal/Goals";
import { ExtensionPack } from "../../api/machine/ExtensionPack";
import { FunctionalUnit } from "../../api/machine/FunctionalUnit";
import { SoftwareDeliveryMachine } from "../../api/machine/SoftwareDeliveryMachine";
import { ArtifactGoal, BuildGoal, JustBuildGoal, StagingEndpointGoal, StagingVerifiedGoal } from "../../api/machine/wellKnownGoals";
import { GoalSetter } from "../../api/mapping/GoalSetter";
import { PushMapping } from "../../api/mapping/PushMapping";
import { PushTest } from "../../api/mapping/PushTest";
import { AnyPush } from "../../api/mapping/support/commonPushTests";
import { PushRule } from "../../api/mapping/support/PushRule";
import { PushRules } from "../../api/mapping/support/PushRules";
import { StaticPushMapping } from "../../api/mapping/support/StaticPushMapping";
import { CommandHandlerRegistration } from "../../api/registration/CommandHandlerRegistration";
import { EditorRegistration } from "../../api/registration/EditorRegistration";
import { GeneratorRegistration } from "../../api/registration/GeneratorRegistration";
import { deleteRepositoryCommand } from "../../handlers/commands/deleteRepository";
import { disposeCommand } from "../../handlers/commands/disposeCommand";
import { FindArtifactOnImageLinked } from "../../handlers/events/delivery/build/FindArtifactOnImageLinked";
import { InvokeListenersOnBuildComplete } from "../../handlers/events/delivery/build/InvokeListenersOnBuildComplete";
import { SetGoalOnBuildComplete } from "../../handlers/events/delivery/build/SetStatusOnBuildComplete";
import { ReactToSemanticDiffsOnPushImpact } from "../../handlers/events/delivery/code/ReactToSemanticDiffsOnPushImpact";
import { OnDeployStatus } from "../../handlers/events/delivery/deploy/OnDeployStatus";
import { FulfillGoalOnRequested } from "../../handlers/events/delivery/goals/FulfillGoalOnRequested";
import { KubernetesIsolatedGoalLauncher } from "../../handlers/events/delivery/goals/k8s/launchGoalK8";
import { RequestDownstreamGoalsOnGoalSuccess } from "../../handlers/events/delivery/goals/RequestDownstreamGoalsOnGoalSuccess";
import { resetGoalsCommand } from "../../handlers/events/delivery/goals/resetGoals";
import { RespondOnGoalCompletion } from "../../handlers/events/delivery/goals/RespondOnGoalCompletion";
import { SetGoalsOnPush } from "../../handlers/events/delivery/goals/SetGoalsOnPush";
import { SkipDownstreamGoalsOnGoalFailure } from "../../handlers/events/delivery/goals/SkipDownstreamGoalsOnGoalFailure";
import { executeVerifyEndpoint, SdmVerification } from "../../handlers/events/delivery/verify/executeVerifyEndpoint";
import { OnVerifiedDeploymentStatus } from "../../handlers/events/delivery/verify/OnVerifiedDeploymentStatus";
import { ClosedIssueHandler } from "../../handlers/events/issue/ClosedIssueHandler";
import { NewIssueHandler } from "../../handlers/events/issue/NewIssueHandler";
import { UpdatedIssueHandler } from "../../handlers/events/issue/UpdatedIssueHandler";
import { OnChannelLink } from "../../handlers/events/repo/OnChannelLink";
import { OnFirstPushToRepo } from "../../handlers/events/repo/OnFirstPushToRepo";
import { OnPullRequest } from "../../handlers/events/repo/OnPullRequest";
import { OnRepoCreation } from "../../handlers/events/repo/OnRepoCreation";
import { OnRepoOnboarded } from "../../handlers/events/repo/OnRepoOnboarded";
import { OnTag } from "../../handlers/events/repo/OnTag";
import { OnUserJoiningChannel } from "../../handlers/events/repo/OnUserJoiningChannel";
import { ConcreteSoftwareDeliveryMachineOptions } from "../../machine/ConcreteSoftwareDeliveryMachineOptions";
import { Builder } from "../../spi/build/Builder";
import { Target } from "../../spi/deploy/Target";
import { InterpretLog } from "../../spi/log/InterpretedLog";
import { executeBuild } from "../delivery/build/executeBuild";
import { executeDeploy } from "../delivery/deploy/executeDeploy";
import { executeUndeploy } from "../delivery/deploy/executeUndeploy";
import { lastLinesLogInterpreter } from "../delivery/goals/support/logInterpreters";

/**
 * Implementation of SoftwareDeliveryMachine.
 * Not intended for direct user instantiation. See machineFactory.ts
 */
export class ConcreteSoftwareDeliveryMachine
    extends ListenerRegistrationManagerSupport
    implements SoftwareDeliveryMachine<ConcreteSoftwareDeliveryMachineOptions> {

    private readonly registrationManager = new RegistrationManagerSupport(this);

    private pushMap: GoalSetter;

    private readonly disposalGoalSetters: GoalSetter[] = [];

    // Maintained depending on whether this SDM might mutate
    private mightMutate: boolean = false;

    /**
     * Return the PushMapping that will be used on pushes.
     * Useful in testing goal setting.
     * @return {PushMapping<Goals>}
     */
    get pushMapping(): PushMapping<Goals> {
        return this.pushMap;
    }

    /**
     * Return if this SDM purely observes, rather than changes an org.
     * Note that this cannot be 100% reliable, as arbitrary event handlers
     * could be making commits, initiating deployments etc.
     * @return {boolean}
     */
    get observesOnly(): boolean {
        if (this.mightMutate) {
            return false;
        }
        return this.autofixRegistrations.length === 0;
    }

    /*
     * Store all the implementations we know
     */
    public readonly goalFulfillmentMapper = new SdmGoalImplementationMapperImpl(
        // For now we only support kube or in process
        process.env.ATOMIST_GOAL_LAUNCHER === "kubernetes" ? KubernetesIsolatedGoalLauncher : undefined); // public for testing

    /**
     * Provide the implementation for a goal.
     * The SDM will run it as soon as the goal is ready (all preconditions are met).
     * If you provide a PushTest, then the SDM can assign different implementations
     * to the same goal based on the code in the project.
     * @param {string} implementationName
     * @param {Goal} goal
     * @param {ExecuteGoalWithLog} goalExecutor
     * @param options PushTest to narrow matching & InterpretLog that can handle
     * the log from the goalExecutor function
     * @return {this}
     */
    public addGoalImplementation(implementationName: string,
                                 goal: Goal,
                                 goalExecutor: ExecuteGoalWithLog,
                                 options?: Partial<{
                                     pushTest: PushTest,
                                     logInterpreter: InterpretLog,
                                 }>): this {
        const optsToUse = {
            pushTest: AnyPush,
            logInterpreter: lastLinesLogInterpreter(implementationName, 10),
            ...options,
        };
        const implementation = {
            implementationName, goal, goalExecutor,
            pushTest: optsToUse.pushTest,
            logInterpreter: optsToUse.logInterpreter,
        };
        this.goalFulfillmentMapper.addImplementation(implementation);
        return this;
    }

    public addVerifyImplementation(): this {
        const stagingVerification: SdmVerification = {
            verifiers: this.endpointVerificationListeners,
            endpointGoal: StagingEndpointGoal,
            requestApproval: true,
        };
        return this.addGoalImplementation("VerifyInStaging",
            StagingVerifiedGoal,
            executeVerifyEndpoint(stagingVerification, this.options.repoRefResolver));
    }

    public addDisposalRules(...goalSetters: GoalSetter[]): this {
        this.disposalGoalSetters.push(...goalSetters);
        return this;
    }

    private get onRepoCreation(): Maker<OnRepoCreation> {
        return this.repoCreationListeners.length > 0 ?
            () => new OnRepoCreation(this.repoCreationListeners, this.options.repoRefResolver, this.options.credentialsResolver) :
            undefined;
    }

    private get onNewRepoWithCode(): Maker<OnFirstPushToRepo> {
        return this.newRepoWithCodeActions.length > 0 ?
            () => new OnFirstPushToRepo(this.newRepoWithCodeActions, this.options.repoRefResolver, this.options.credentialsResolver) :
            undefined;
    }

    private get semanticDiffReactor(): Maker<ReactToSemanticDiffsOnPushImpact> {
        return this.fingerprintDifferenceListeners.length > 0 ?
            () => new ReactToSemanticDiffsOnPushImpact(
                this.fingerprintDifferenceListeners,
                this.options.repoRefResolver,
                this.options.credentialsResolver) :
            undefined;
    }

    private get goalSetting(): FunctionalUnit {
        return {
            eventHandlers: [() => new SetGoalsOnPush(
                this.options.projectLoader,
                this.options.repoRefResolver,
                this.pushMapping,
                this.goalsSetListeners,
                this.goalFulfillmentMapper, this.options.credentialsResolver)],
            commandHandlers: [() => resetGoalsCommand({
                projectLoader: this.options.projectLoader,
                repoRefResolver: this.options.repoRefResolver,
                goalsListeners: this.goalsSetListeners,
                goalSetter: this.pushMapping,
                implementationMapping: this.goalFulfillmentMapper,
            })],
        };
    }

    private get goalConsequences(): FunctionalUnit {
        return {
            eventHandlers: [
                () => new SkipDownstreamGoalsOnGoalFailure(this.options.repoRefResolver),
                () => new RequestDownstreamGoalsOnGoalSuccess(this.goalFulfillmentMapper, this.options.repoRefResolver),
                () => new RespondOnGoalCompletion(
                    this.options.repoRefResolver,
                    this.options.credentialsResolver,
                    this.goalCompletionListeners)],
            commandHandlers: [],
        };
    }

    private readonly artifactFinder = () => new FindArtifactOnImageLinked(
        ArtifactGoal,
        this.options,
        this.artifactListenerRegistrations,
        this.options.credentialsResolver);

    private get notifyOnDeploy(): Maker<OnDeployStatus> {
        return this.deploymentListeners.length > 0 ?
            () => new OnDeployStatus(this.deploymentListeners, this.options.repoRefResolver, this.options.credentialsResolver) :
            undefined;
    }

    private get onVerifiedStatus(): Maker<OnVerifiedDeploymentStatus> {
        return this.verifiedDeploymentListeners.length > 0 ?
            () => new OnVerifiedDeploymentStatus(this.verifiedDeploymentListeners, this.options.repoRefResolver, this.options.credentialsResolver) :
            undefined;
    }

    private get disposal(): FunctionalUnit {
        return {
            commandHandlers: [
                () => disposeCommand({
                    goalSetter: new PushRules("disposal", this.disposalGoalSetters),
                    repoRefResolver: this.options.repoRefResolver,
                    projectLoader: this.options.projectLoader,
                    goalsListeners: this.goalsSetListeners,
                    implementationMapping: this.goalFulfillmentMapper,
                }),
                deleteRepositoryCommand],
            eventHandlers: [],
        };
    }

    private readonly onBuildComplete: Maker<SetGoalOnBuildComplete> =
        () => new SetGoalOnBuildComplete([BuildGoal, JustBuildGoal], this.options.repoRefResolver);

    private get allFunctionalUnits(): FunctionalUnit[] {
        return []
            .concat([
                this.goalSetting,
                this.goalConsequences,
                this.disposal,
            ]);
    }

    get eventHandlers(): Array<Maker<HandleEvent<any>>> {
        return this.registrationManager.eventHandlers
            .concat(() => new FulfillGoalOnRequested(this.goalFulfillmentMapper,
                this.options.projectLoader,
                this.options.repoRefResolver,
                this.options.logFactory))
            .concat(_.flatten(this.allFunctionalUnits.map(fu => fu.eventHandlers)))
            .concat([
                this.userJoiningChannelListeners.length > 0 ?
                    () => new OnUserJoiningChannel(this.userJoiningChannelListeners, this.options.repoRefResolver, this.options.credentialsResolver) :
                    undefined,
                this.buildListeners.length > 0 ?
                    () => new InvokeListenersOnBuildComplete(this.buildListeners, this.options.repoRefResolver, this.options.credentialsResolver) :
                    undefined,
                this.tagListeners.length > 0 ?
                    () => new OnTag(this.tagListeners, this.options.repoRefResolver, this.options.credentialsResolver) :
                    undefined,
                this.newIssueListeners.length > 0 ?
                    () => new NewIssueHandler(this.newIssueListeners, this.options.repoRefResolver, this.options.credentialsResolver) :
                    undefined,
                this.updatedIssueListeners.length > 0 ?
                    () => new UpdatedIssueHandler(this.updatedIssueListeners, this.options.repoRefResolver, this.options.credentialsResolver) :
                    undefined,
                this.closedIssueListeners.length > 0 ?
                    () => new ClosedIssueHandler(this.closedIssueListeners, this.options.repoRefResolver, this.options.credentialsResolver) :
                    undefined,
                this.channelLinkListeners.length > 0 ?
                    () => new OnChannelLink(
                        this.options.projectLoader,
                        this.options.repoRefResolver,
                        this.channelLinkListeners, this.options.credentialsResolver) :
                    undefined,
                this.pullRequestListeners.length > 0 ?
                    () => new OnPullRequest(this.options.projectLoader, this.options.repoRefResolver, this.pullRequestListeners,
                        this.options.credentialsResolver) : undefined,
                this.repoOnboardingListeners.length > 0 ?
                    () => new OnRepoOnboarded(this.repoOnboardingListeners, this.options.repoRefResolver, this.options.credentialsResolver) :
                    undefined,
                this.onRepoCreation,
                this.onNewRepoWithCode,
                this.semanticDiffReactor,
                this.onBuildComplete,
                this.notifyOnDeploy,
                this.onVerifiedStatus,
                this.artifactFinder,
            ]).filter(m => !!m);
    }

    get commandHandlers(): Array<Maker<HandleCommand>> {
        return this.registrationManager.commandHandlers
            .concat(_.flatten(this.allFunctionalUnits.map(fu => fu.commandHandlers)))
            .filter(m => !!m);
    }

    public addCommands(...cmds: Array<CommandHandlerRegistration<any>>): this {
        this.registrationManager.addCommands(...cmds);
        return this;
    }

    public addGenerators(...gens: Array<GeneratorRegistration<any>>): this {
        this.registrationManager.addGenerators(...gens);
        return this;
    }

    public addEditors(...eds: EditorRegistration[]): this {
        this.registrationManager.addEditors(...eds);
        return this;
    }

    public addSupportingCommands(...e: Array<Maker<HandleCommand>>): this {
        this.registrationManager.addSupportingCommands(...e);
        return this;
    }

    public addSupportingEvents(...e: Array<Maker<HandleEvent<any>>>): this {
        this.registrationManager.addSupportingEvents(...e);
        return this;
    }

    public addBuildRules(...rules: Array<PushRule<Builder> | Array<PushRule<Builder>>>): this {
        this.mightMutate = rules.length > 0;
        _.flatten(rules).forEach(r =>
            this.addGoalImplementation(r.name, BuildGoal,
                executeBuild(this.options.projectLoader, r.value),
                {
                    pushTest: r.pushTest,
                    logInterpreter: r.value.logInterpreter,
                })
                .addGoalImplementation(r.name, JustBuildGoal,
                    executeBuild(this.options.projectLoader, r.value),
                    {
                        pushTest: r.pushTest,
                        logInterpreter:
                        r.value.logInterpreter,
                    },
                ));
        return this;
    }

    public addDeployRules(...rules: Array<StaticPushMapping<Target> | Array<StaticPushMapping<Target>>>): this {
        this.mightMutate = rules.length > 0;
        _.flatten(rules).forEach(r => {
            // deploy
            this.addGoalImplementation(r.name, r.value.deployGoal, executeDeploy(
                this.options.artifactStore,
                this.options.repoRefResolver,
                r.value.endpointGoal, r.value),
                {
                    pushTest: r.pushTest,
                    logInterpreter: r.value.deployer.logInterpreter,
                },
            );
            // endpoint
            this.addKnownSideEffect(
                r.value.endpointGoal,
                r.value.deployGoal.definition.displayName);
            // undeploy
            this.addGoalImplementation(r.name, r.value.undeployGoal, executeUndeploy(r.value),
                {
                    pushTest: r.pushTest,
                    logInterpreter: r.value.deployer.logInterpreter,
                },
            );
        });
        return this;
    }

    /**
     * Declare that a goal will become successful based on something outside.
     * For instance, ArtifactGoal succeeds because of an ImageLink event.
     * This tells the SDM that it does not need to run anything when this
     * goal becomes ready.
     * @param {Goal} goal
     * @param {string} sideEffectName
     * @param {PushTest} pushTest
     */
    public addKnownSideEffect(goal: Goal, sideEffectName: string,
                              pushTest: PushTest = AnyPush): this {
        this.goalFulfillmentMapper.addSideEffect({
            goal,
            sideEffectName, pushTest,
        });
        return this;
    }

    public addExtensionPacks(...packs: ExtensionPack[]): this {
        for (const configurer of packs) {
            this.addExtensionPack(configurer);
            if (!!configurer.goalContributions) {
                this.pushMap = enrichGoalSetters(this.pushMap, configurer.goalContributions);
            }
        }
        return this;
    }

    private addExtensionPack(pack: ExtensionPack): this {
        logger.info("Adding extension pack '%s' version %s from %s",
            pack.name, pack.version, pack.vendor);
        pack.configure(this);
        return this;
    }

    /**
     * Construct a new software delivery machine, with zero or
     * more goal setters.
     * @param {string} name
     * @param {ConcreteSoftwareDeliveryMachineOptions} options
     * @param configuration automation client configuration we're running in
     * @param {GoalSetter} goalSetters tell me what to do on a push. Hint: start with "whenPushSatisfies(...)"
     */
    constructor(public readonly name: string,
                public readonly options: ConcreteSoftwareDeliveryMachineOptions,
                public readonly configuration: Configuration,
                goalSetters: Array<GoalSetter | GoalSetter[]>) {
        super();
        this.pushMap = new PushRules("Goal setters", _.flatten(goalSetters));
        addWellKnownGoals(this);
    }

}
