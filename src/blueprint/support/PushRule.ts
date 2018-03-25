/*
 * Copyright © 2018 Atomist, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { PushTest } from "../../common/listener/PushTest";
import { StaticPushMapping } from "../../common/listener/support/StaticPushMapping";
import { allSatisfied, memoize } from "../../common/listener/support/pushtest/pushTestUtils";
import { PushMapping } from "../../common/listener/PushMapping";
import { ProjectListenerInvocation } from "../../common/listener/Listener";

/**
 * Generic DSL for returning an object on a push
 */
export class PushRule<V = any> implements PushMapping<V> {

    public choice: PushMapping<V>;

    public get name(): string {
        return this.choice.name;
    }

    public readonly pushTest: PushTest;

    constructor(protected guard1: PushTest, protected guards: PushTest[], public reason?: string) {
        this.pushTest = allSatisfied(memoize(guard1), ...guards.map(memoize));
    }

    public set(value: V): this {
        this.verify();
        this.choice = new StaticPushMapping<V>(value, this.guard1, ...this.guards);
        return this;
    }

    public test(p: ProjectListenerInvocation): Promise<V> | V {
        return this.choice.test(p);
    }

    public verify(): this {
        if (!this.reason) {
            throw new Error("Incomplete PushTest: Required reason");
        }
        return this;
    }

}

/**
 * Interim DSL stage
 */
export class PushRuleExplanation<N extends PushRule<any>> {

    constructor(private pushRule: N) {}

    public itMeans(reason: string): N {
        this.pushRule.reason = reason;
        return this.pushRule.verify();
    }
}
