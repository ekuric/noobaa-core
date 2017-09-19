export default {
    type: 'object',
    required: [
        'metadataLoaded',
        'selected'
    ],
    properties: {
        metadataLoaded: {
            type: 'boolean'
        },
        selected: {
            type: ['object', 'null']
        }
    }
};
