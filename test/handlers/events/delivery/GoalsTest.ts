import "mocha";
import * as assert from "power-assert";
import {BaseContext, contextIsAfter, splitContext} from "../../../../src/common/goals/gitHubContext";
import {
    BuildContext,
    ProductionDeploymentContext, ProductionEndpointContext, ReviewContext, StagingDeploymentContext,
    StagingEndpointContext,
} from "../../../../src/handlers/events/delivery/goals/httpServiceGoals";

describe("Goal handling", () => {

   it("parses my contexts", () => {
       const result = splitContext(ReviewContext);
       assert.equal(result.name, "review");
       assert.equal(result.base, BaseContext);
       assert.equal(result.env, "code");
       assert.equal(result.envOrder, 0);
       assert.equal(result.goalOrder, 1);
   });

   it("says endpoint is after deploy", () => {
       assert(contextIsAfter(StagingDeploymentContext, StagingEndpointContext));
   });

   it("says deploy is after build", () => {
       assert(contextIsAfter(BuildContext, StagingDeploymentContext));
   });

   it("says prod endpoint is after prod ", () => {
        assert(contextIsAfter(ProductionDeploymentContext, ProductionEndpointContext));
    });

});
