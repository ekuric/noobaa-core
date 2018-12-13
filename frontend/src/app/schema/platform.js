/* Copyright (C) 2016 NooBaa */

export default {
    type: 'object',
    required: [
        'kind',
        'restrictions'
    ],
    properties: {
        kind: {
            type: 'string'
        },
        featureFlags: {
            type: 'object',
            required: [
                'vmToolsInstallation',
                'serverClockConfig',
                'systemAddressChange',
                'dnsServersChange',
                'serverAttachment',
                'p2pSettingsChange',
                'serverDetailsChange',
                'clusterConnectivityIpChange'
            ],
            properties: {
                vmToolsInstallation: {
                    type: 'boolean'
                },
                serverClockConfig: {
                    type: 'boolean'
                },
                systemAddressChange: {
                    type: 'boolean'
                },
                dnsServersChange: {
                    type: 'boolean'
                },
                serverAttachment: {
                    type: 'boolean'
                },
                p2pSettingsChange: {
                    type: 'boolean'
                },
                serverDetailsChange: {
                    type: 'boolean'
                },
                clusterConnectivityIpChange: {
                    type: 'boolean'
                }
            }
        }
    }
};
