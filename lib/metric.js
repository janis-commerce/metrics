'use strict';

/**
 * This callback is displayed as part of the Requester class.
 * @callback MetricEventEmitterCallback
 * @param {Array<Object>} failedMetrics
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
const DELIVERY_STREAM_PREFIX = 'kpi-metrics-per-client';
const METRICS_BATCH_LIMIT = 500;

const emitter = new EventEmitter();

module.exports = class Metric {

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

		return [
			'local',
			'beta',
			'qa',
			'prod'
		];
	}

	/**
	 * @static
	 * @returns {string} The delivery stream name per environment to be used in Firehose
	 */
	static get deliveryStreamName() {

		if(!this._deliveryStreamName)
			this._deliveryStreamName = `${DELIVERY_STREAM_PREFIX}-${this.formattedEnv}`;

		return this._deliveryStreamName;
	}

	/**
	 * @static
	 * @returns {string} The friendly name of the current env
	 * @throws {MetricError} If current env is not defined or it's invalid
	 */
	static get formattedEnv() {

		if(!this.envs.includes(this.env))
			throw new MetricError('Unknown environment', MetricError.codes.NO_ENVIRONMENT);

		return this.env;
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
	 * @param {string} clientCode The client code who created the metric
	 * @param {string} name The name to reference the metric
	 * @param {Object|Array.<Object>} metrics The metric object or metric objects array
	 * @returns {Promise<void>}
	 *
	 * @example
	 * Metric.add('some-client', 'some-name', {
	 *   some: 'metric'
	 * });
	 */
	static async add(clientCode, name, metrics) {

		// For local development
		if(this.env === 'local')
			return true;

		if(!Array.isArray(metrics))
			metrics = [metrics];

		let validMetrics;

		try {
			validMetrics = metrics.map(metric => validateMetric(clientCode, name, metric));
		} catch(err) {
			return emitter.emit('create-error', metrics, err);
		}

		const metricsBatches = this.createMetricsBatches(validMetrics);
		return this._add(metricsBatches);
	}

	/**
	 * @private
	 * @static
	 * @param {Array<Object>} metrics
	 * @returns {Array<Array<Object>>}
	 */
	static createMetricsBatches(metrics) {
		return arrayChunk(metrics, METRICS_BATCH_LIMIT);
	}

	/**
	 * @private
	 * @static
	 * @param {Array<Array<Object>>} metricsBatches
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
