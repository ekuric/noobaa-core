import template from './set-cloud-sync-modal.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { systemInfo, sessionInfo, cloudBucketList } from 'model';
import { loadCloudBucketList, setCloudSyncPolicy } from 'actions';
import { deepFreeze } from 'utils/all';

const [ MIN, HOUR, DAY ] = [ 1, 60, 60 * 24 ];

const frequencyUnitOptions = deepFreeze([
    {
        value: MIN,
        label: 'Minutes'
    },
    {
        value: HOUR,
        label: 'Hours'
    },
    {
        value: DAY,
        label: 'Days'
    }
]);

const directionOptions = deepFreeze([
    {
        value: 3,
        label: 'Bi-Direcitonal'
    },
    {
        value: 1,
        label: 'Source to Target'
    },
    {
        value: 2,
        label: 'Target to Source'
    }
]);

const addConnectionOption = deepFreeze({
    label: 'Add new connection',
    value: {}
});

const allowedServices = deepFreeze([
    'AWS',
    'S3_COMPATIBLE'
]);

class SetCloudSyncModalViewModel extends Disposable {
    constructor({ bucketName, onClose }) {
        super();

        this.allowedServices = allowedServices;
        this.onClose = onClose;
        this.bucketName = bucketName;

        const cloudConnections = ko.pureComputed(
            () => {
                const user = (systemInfo() ? systemInfo().accounts : []).find(
                    account => account.email === sessionInfo().user
                );

                return user.external_connections || [];
            }
        );

        this.connectionOptions = ko.pureComputed(
            () => [
                addConnectionOption,
                null,
                ...cloudConnections()
                    .filter(
                        connection => allowedServices.some(
                            service => connection.endpoint_type === service
                        )
                    )
                    .map(
                        connection => ({
                            label: connection.name || connection.identity,
                            value: connection
                        })
                    )
            ]
        );

        let _connection = ko.observable();
        this.connection = ko.pureComputed({
            read: _connection,
            write: value => {
                if (value !== addConnectionOption.value) {
                    _connection(value);
                } else {
                    _connection(_connection() || null);
                    this.isAddCloudConnectionModalVisible(true);
                }
            }
        })
            .extend({
                required: { message: 'Please select a connection from the list' }
            });

        this.addToDisposeList(
            this.connection.subscribe(
                value => {
                    this.targetBucket(null);
                    value && this.loadBucketsList();
                }
            )
        );

        this.targetBucketsOptions = ko.pureComputed(
            () => {
                if (!this.connection() || !cloudBucketList()) {
                    return;
                }

                return cloudBucketList().map(
                    bucketName => ({ value: bucketName })
                );
            }
        );

        this.targetBucket = ko.observable()
            .extend({
                required: {
                    onlyIf: this.connection,
                    message: 'Please select a bucket from the list'
                }
            });

        this.direction = ko.observable(3);
        this.directionOptions = directionOptions;

        this.frequency = ko.observable(1);
        this.frequencyUnit = ko.observable(HOUR);
        this.frequencyUnitOptions = frequencyUnitOptions;

        let _syncDeletions = ko.observable(true);
        this.syncDeletions = ko.pureComputed({
            read: () => this.direction() === 3 ? true : _syncDeletions(),
            write: _syncDeletions
        });

        this.isAddCloudConnectionModalVisible = ko.observable(false);

        this.errors = ko.validation.group([
            this.connection,
            this.targetBucket
        ]);
    }

    loadBucketsList() {
        loadCloudBucketList(this.connection().name);
    }

    showAddCloudConnectionModal() {
        this.connection.isModified(false);
        this.isAddCloudConnectionModalVisible(true);
    }

    hideAddCloudConnectionModal() {
        this.isAddCloudConnectionModalVisible(false);
    }

    cancel() {
        this.onClose();
    }

    save() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();

        } else {
            setCloudSyncPolicy(
                ko.unwrap(this.bucketName),
                this.connection().name,
                this.targetBucket(),
                this.direction(),
                this.frequency() * this.frequencyUnit(),
                this.syncDeletions()
            );
            this.onClose();
        }
    }
}

export default {
    viewModel: SetCloudSyncModalViewModel,
    template: template
};
