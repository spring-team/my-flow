
import axios from "axios";
import { EndpointVerificationInvocation, OnEndpointStatus } from "../OnEndpointStatus";

/**
 * Make an HTTP request to the reported endpoint to check
 * @type {OnEndpointStatus}
 */
export const LookFor200OnEndpointRootGet = () => new OnEndpointStatus(
    (inv: EndpointVerificationInvocation) => {
        return axios.get(inv.url)
            .then(resp => {
                if (resp.status !== 200) {
                    return Promise.reject(`Unexpected response: ${resp.status}`);
                }
                return Promise.resolve();
            });
            // Let a failure go through
    },
);
