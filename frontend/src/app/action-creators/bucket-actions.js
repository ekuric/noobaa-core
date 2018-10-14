import {
    CREATE_BUCKET,
    COMPLETE_CREATE_BUCKET,
    FAIL_CREATE_BUCKET,
    UPDATE_BUCKET_QUOTA_POLICY,
    COMPLETE_UPDATE_BUCKET_QUOTA_POLICY,
    FAIL_UPDATE_BUCKET_QUOTA_POLICY,
    UPDATE_BUCKET_PLACEMENT_POLICY,
    COMPLETE_UPDATE_BUCKET_PLACEMENT_POLICY,
    FAIL_UPDATE_BUCKET_PLACEMENT_POLICY,
    UPDATE_BUCKET_RESILIENCY_POLICY,
    COMPLETE_UPDATE_BUCKET_RESILIENCY_POLICY,
    FAIL_UPDATE_BUCKET_RESILIENCY_POLICY,
    UPDATE_BUCKET_VERSIONING_POLICY,
    COMPLETE_UPDATE_BUCKET_VERSIONING_POLICY,
    FAIL_UPDATE_BUCKET_VERSIONING_POLICY,
    DELETE_BUCKET,
    COMPLETE_DELETE_BUCKET,
    FAIL_DELETE_BUCKET,
    CREATE_NAMESPACE_BUCKET,
    COMPLETE_CREATE_NAMESPACE_BUCKET,
    FAIL_CREATE_NAMESPACE_BUCKET,
    UPDATE_NAMESPACE_BUCKET_PLACEMENT,
    COMPLETE_UPDATE_NAMESPACE_BUCKET_PLACEMENT,
    FAIL_UPDATE_NAMESPACE_BUCKET_PLACEMENT,
    DELETE_NAMESPACE_BUCKET,
    COMPLETE_DELETE_NAMESPACE_BUCKET,
    FAIL_DELETE_NAMESPACE_BUCKET,
    UPDATE_BUCKET_S3_ACCESS,
    COMPLETE_UPDATE_BUCKET_S3_ACCESS,
    FAIL_UPDATE_BUCKET_S3_ACCESS,
    ADD_BUCKET_TRIGGER,
    COMPLETE_ADD_BUCKET_TRIGGER,
    FAIL_ADD_BUCKET_TRIGGER,
    UPDATE_BUCKET_TRIGGER,
    COMPLETE_UPDATE_BUCKET_TRIGGER,
    FAIL_UPDATE_BUCKET_TRIGGER,
    REMOVE_BUCKET_TRIGGER,
    COMPLETE_REMOVE_BUCKET_TRIGGER,
    FAIL_REMOVE_BUCKET_TRIGGER
} from 'action-types';

export function createBucket(name, placementType, resources) {
    return {
        type: CREATE_BUCKET,
        payload: { name, placementType, resources }
    };
}

export function completeCreateBucket(name) {
    return {
        type: COMPLETE_CREATE_BUCKET,
        payload: { name }
    };
}

export function failCreateBucket(name, error) {
    return {
        type: FAIL_CREATE_BUCKET,
        payload: { name, error }
    };
}

export function updateBucketQuotaPolicy(bucket, quota) {
    return {
        type: UPDATE_BUCKET_QUOTA_POLICY,
        payload: { bucket, quota }
    };
}

export function completeUpdateBucketQuotaPolicy(bucket) {
    return {
        type: COMPLETE_UPDATE_BUCKET_QUOTA_POLICY,
        payload: { bucket }
    };
}

export function failUpdateBucketQuotaPolicy(bucket, error) {
    return {
        type: FAIL_UPDATE_BUCKET_QUOTA_POLICY,
        payload: { bucket, error }
    };
}

export function updateBucketPlacementPolicy(bucket, tier, policyType, resources) {
    return {
        type: UPDATE_BUCKET_PLACEMENT_POLICY,
        payload: { bucket, tier, policyType,resources }
    };
}

export function completeUpdateBucketPlacementPolicy(bucket) {
    return {
        type: COMPLETE_UPDATE_BUCKET_PLACEMENT_POLICY,
        payload: { bucket }
    };
}

export function failUpdateBucketPlacementPolicy(bucket, error) {
    return {
        type: FAIL_UPDATE_BUCKET_PLACEMENT_POLICY,
        payload: { bucket, error }
    };
}

export function updateBucketResiliencyPolicy(bucket, tier, policy) {
    return {
        type: UPDATE_BUCKET_RESILIENCY_POLICY,
        payload: { bucket, tier, policy }
    };
}

export function completeUpdateBucketResiliencyPolicy(bucket) {
    return {
        type: COMPLETE_UPDATE_BUCKET_RESILIENCY_POLICY,
        payload: { bucket }
    };
}

export function failUpdateBucketResiliencyPolicy(bucket, error) {
    return {
        type: FAIL_UPDATE_BUCKET_RESILIENCY_POLICY,
        payload: { bucket, error }
    };
}

export function updateBucketVersioningPolicy(bucket, versioning) {
    return {
        type: UPDATE_BUCKET_VERSIONING_POLICY,
        payload: { bucket, versioning }
    };
}

export function completeUpdateBucketVersioningPolicy(bucket, versioning) {
    return {
        type: COMPLETE_UPDATE_BUCKET_VERSIONING_POLICY,
        payload: { bucket, versioning }
    };
}

export function failUpdateBucketVersioningPolicy(bucket, versioning, error) {
    return {
        type: FAIL_UPDATE_BUCKET_VERSIONING_POLICY,
        payload: { bucket, versioning, error }
    };
}

export function deleteBucket(bucket){
    return {
        type: DELETE_BUCKET,
        payload: { bucket }
    };
}

export function completeDeleteBucket(bucket) {
    return {
        type: COMPLETE_DELETE_BUCKET,
        payload: { bucket }
    };
}

export function failDeleteBucket(bucket, error) {
    return {
        type: FAIL_DELETE_BUCKET,
        payload: { bucket, error }

    };
}

export function createNamespaceBucket(name, readFrom, writeTo) {
    return {
        type: CREATE_NAMESPACE_BUCKET,
        payload: { name, readFrom, writeTo }
    };
}

export function completeCreateNamespaceBucket(name) {
    return {
        type: COMPLETE_CREATE_NAMESPACE_BUCKET,
        payload: { name }
    };
}

export function failCreateNamespaceBucket(name, error) {
    return {
        type: FAIL_CREATE_NAMESPACE_BUCKET,
        payload: { name, error }
    };
}

export function updateNamespaceBucketPlacement(name, readFrom, writeTo) {
    return {
        type: UPDATE_NAMESPACE_BUCKET_PLACEMENT,
        payload: { name, readFrom, writeTo }
    };
}

export function completeUpdateNamespaceBucketPlacement(name) {
    return {
        type: COMPLETE_UPDATE_NAMESPACE_BUCKET_PLACEMENT,
        payload: { name }
    };
}

export function failNamespaceBucketPlacement(name, error) {
    return {
        type: FAIL_UPDATE_NAMESPACE_BUCKET_PLACEMENT,
        payload: { name, error }
    };
}

export function deleteNamespaceBucket(name) {
    return {
        type: DELETE_NAMESPACE_BUCKET,
        payload: { name }
    };
}

export function completeDeleteNamespaceBucket(name) {
    return {
        type: COMPLETE_DELETE_NAMESPACE_BUCKET,
        payload: { name }
    };
}

export function failCompleteDeleteNamespaceBucket(name, error) {
    return {
        type: FAIL_DELETE_NAMESPACE_BUCKET,
        payload: { name, error }
    };
}

export function updateBucketS3Access(bucketName, allowedAccounts) {
    return {
        type: UPDATE_BUCKET_S3_ACCESS,
        payload: { bucketName, allowedAccounts }
    };
}

export function completeUpdateBucketS3Access(bucketName) {
    return {
        type: COMPLETE_UPDATE_BUCKET_S3_ACCESS,
        payload: { bucketName }
    };
}

export function failUpdateBucketS3Access(bucketName, error) {
    return {
        type: FAIL_UPDATE_BUCKET_S3_ACCESS,
        payload: { bucketName, error }
    };
}

export function addBucketTrigger(bucketName, config) {

    return {
        type: ADD_BUCKET_TRIGGER,
        payload: { bucketName, config }
    };
}

export function completeAddBucketTrigger(bucketName) {
    return {
        type: COMPLETE_ADD_BUCKET_TRIGGER,
        payload: { bucketName }
    };
}

export function failAddBucketTrigger(bucketName, error) {
    return {
        type: FAIL_ADD_BUCKET_TRIGGER,
        payload: { bucketName, error }
    };
}

export function updateBucketTrigger(bucketName, triggerId, config) {

    return {
        type: UPDATE_BUCKET_TRIGGER,
        payload: { bucketName, triggerId, config }
    };
}

export function completeUpdateBucketTrigger(bucketName) {
    return {
        type: COMPLETE_UPDATE_BUCKET_TRIGGER,
        payload: { bucketName }
    };
}

export function failUpdateBucketTrigger(bucketName, error) {
    return {
        type: FAIL_UPDATE_BUCKET_TRIGGER,
        payload: { bucketName, error }
    };
}

export function removeBucketTrigger(bucketName, triggerId) {
    return {
        type: REMOVE_BUCKET_TRIGGER,
        payload: { bucketName, triggerId }
    };
}

export function completeRemoveBucketTrigger(bucketName) {
    return {
        type: COMPLETE_REMOVE_BUCKET_TRIGGER,
        payload: { bucketName }
    };
}

export function failRemoveBucketTrigger(bucketName, error) {
    return {
        type: FAIL_REMOVE_BUCKET_TRIGGER,
        payload: { bucketName, error }
    };
}
