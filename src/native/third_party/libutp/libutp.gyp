{
    'includes': ['../../common.gypi'],
    'targets': [{
        'target_name': 'libutp',
        'type': 'static_library',
        'sources': [
            'utp.h',
            'utp_api.cpp',
            'utp_callbacks.cpp',
            'utp_callbacks.h',
            'utp_hash.cpp',
            'utp_hash.h',
            'utp_internal.cpp',
            'utp_internal.h',
            'utp_packedsockaddr.cpp',
            'utp_packedsockaddr.h',
            'utp_templates.h',
            'utp_types.h',
            'utp_utils.cpp',
            'utp_utils.h',
        ],
    }]
}
