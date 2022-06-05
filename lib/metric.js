'use strict';

/**
 * @typedef {object} MetricData
 * @property {string} name
 * @property {object} metric
 */

/**
 * This callback is displayed as part of the Requester class.
 * @callback MetricEventEmitterCallback
 * @param {Array<MetricData>} failedMetrics
 * @param {MetricError} error
 * @returns {void}
 */

const EventEmitter = require('events');
const { arrayChunk } = require('./helpers/utils');
const validateMetric = require('./helpers/validate-metric');
const MetricError = require('./metric-error');
const serverlessConfiguration = require('./serverless-configuration');
const FirehoseInstance = require('./firehose-instance');

const MAX_ATTEMPTS = 3;
const DELIVERY_STREAM_PREFIX = 'JanisTraceFirehose';
const METRICS_BATCH_LIMIT = 500;

const emitter = new EventEmitter();

module.exports = class Metric {

	/**
	 * @static
	 * @returns {string} The service name as defined in the env var JANIS_SERVICE_NAME
	 */
	static get serviceName() {
		return process.env.JANIS_SERVICE_NAME;
	}

	/**
	 * @static
	 * @returns {string} The environment name as defined in the env var JANIS_ENV
	 */
	static get env() {
		return process.env.JANIS_ENV;
	}

	/**
	 * @static
	 * @returns{object<string, string>} A key-value object of environments and their friendly name
	 */
	static get envs() {

		return {
			local: 'Local',
			beta: 'Beta',
			qa: 'QA',
			prod: 'Prod'
		};
	}

	/**
	 * @static
	 * @returns {string} The AWS CloudWatch Logs stream name based on current env
	 */
	static get deliveryStreamName() {

		if(!this._deliveryStreamName)
			this._deliveryStreamName = `${DELIVERY_STREAM_PREFIX}${this.formattedEnv}`;

		return this._deliveryStreamName;
	}

	/**
	 * @static
	 * @returns {string} The friendly name of the current env
	 * @throws {MetricError} If current env is not defined or it's invalid
	 */
	static get formattedEnv() {

		if(this.env && this.envs[this.env])
			return this.envs[this.env];

		throw new MetricError('Unknown environment', MetricError.codes.NO_ENVIRONMENT);
	}

	/**
	 * Sets a callback for the specified event name
	 *
	 * @static
	 * @param {string} event The event name
	 * @param {MetricEventEmitterCallback} callback The event callback
	 * @example
	 * Metric.on('create-error', (metrics, err) => {...});
	 */
	static on(event, callback) {
		emitter.on(event, callback);
	}

	/**
	 * Put metrics into Firehose
	 *
	 * @static
	 * @param {string} client The client code who created the metric
	 * @param {MetricData|Array.<MetricData>} metrics The metric object or metric objects array
	 * @returns {Promise<void>}
	 *
	 * @example
	 * Metric.add('some-client', {
	 *  name: 'some-name'
	 * 	metric: {
	 * 		some: 'metric'
	 * 	}
	 * });
	 */
	static async add(client, metrics) {

		// For local development
		if(this.env === 'local')
			return true;

		if(!Array.isArray(metrics))
			metrics = [metrics];

		let validMetrics;

		try {

			validMetrics = metrics.map(metric => validateMetric(metric, client, this.serviceName));

		} catch(err) {
			return emitter.emit('create-error', metrics, err);
		}

		const metricsBatches = this.createMetricsBatches(validMetrics);
		return this._add(metricsBatches);
	}

	/**
	 * @private
	 * @static
	 * @param {Array<MetricData>} metrics
	 * @returns {Array<Array<MetricData>>}
	 */
	static createMetricsBatches(metrics) {
		return arrayChunk(metrics, METRICS_BATCH_LIMIT);
	}

	/**
	 * @private
	 * @static
	 * @param {Array<Array<MetricData>>} metricsBatches
	 * @param {number} [attempts = 0]
	 * @returns
	 */
	static async _add(metricsBatches, attempts = 0) {

		try {

			const firehose = await FirehoseInstance.getFirehoseInstance();

			await Promise.all(
				metricsBatches.map(metrics => firehose.putRecordBatch(
					{
						DeliveryStreamName: this.deliveryStreamName,
						Records: metrics.map(metric => ({
							Data: Buffer.from(JSON.stringify(metric))
						}))
					}
				))
			);

		} catch(err) {

			attempts++;

			if(attempts >= MAX_ATTEMPTS) {
				return emitter.emit('create-error', metricsBatches,
					new MetricError(`Unable to put the metrics into firehose, max attempts reached: ${err.message}`, MetricError.codes.FIREHOSE_ERROR));
			}

			return this._add(metricsBatches, attempts);
		}
	}

	/**
	 * Returns the sls helpers needed for serverles configuration.
	 *
	 * @static
	 * @returns {Array}
	 */
	static get serverlessConfiguration() {
		return serverlessConfiguration();
	}
};
