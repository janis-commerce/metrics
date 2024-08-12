'use strict';

const FirehoseWrapper = require('./aws-wrappers/firehose');
const StsWrapper = require('./aws-wrappers/sts');
const MetricError = require('./metric-error');

const sts = new StsWrapper();
const ARN_DURATION = 1800; // 30 min
const MAX_TIMEOUT = 500;

module.exports = class FirehoseInstance {

	static get serviceName() {
		return process.env.JANIS_SERVICE_NAME;
	}

	static get roleArn() {
		return process.env.METRIC_ROLE_ARN;
	}

	/**
     * Returns a FirehoseInstance
     *
     * @returns {Object} A FireHoseInstance
     */
	static async getFirehoseInstance() {

		if(!this.validCredentials()) {

			const firehoseParams = {
				region: process.env.AWS_DEFAULT_REGION,
				httpOptions: { timeout: MAX_TIMEOUT }
			};

			if(this.roleArn) {
				firehoseParams.credentials = await this.getCredentials();
				this.credentialsExpiration = new Date(firehoseParams.credentials.expiration);
			}

			this.firehose = new FirehoseWrapper(firehoseParams);
		}

		return this.firehose;
	}

	static validCredentials() {
		return this.firehose
			&& this.credentialsExpiration
			&& this.credentialsExpiration >= new Date();
	}

	static async getCredentials() {

		const assumedRole = await sts.assumeRole({
			RoleArn: this.roleArn,
			RoleSessionName: this.serviceName,
			DurationSeconds: ARN_DURATION
		});

		if(!assumedRole)
			throw new MetricError('Failed to assume role, invalid response.', MetricError.codes.ASSUME_ROLE_ERROR);

		const { Credentials, Expiration } = assumedRole;

		return {
			accessKeyId: Credentials.AccessKeyId,
			secretAccessKey: Credentials.SecretAccessKey,
			sessionToken: Credentials.SessionToken,
			expiration: Expiration
		};
	}
};
