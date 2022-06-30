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
	 * Returns the sls helpers needed for serverles configuration.
	 *
	 * @static
	 * @returns {Array}
	 */
	static get serverlessConfiguration() {
		return serverlessConfiguration();
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

		let metricPromises;

		try {

			const firehose = await FirehoseInstance.getFirehoseInstance();

			metricPromises = await Promise.allSettled(
				metricsBatches.map(metrics => firehose.putRecordBatch(
					{
						DeliveryStreamName: DELIVERY_STREAM_PREFIX,
						Records: metrics.map(metric => ({
							Data: Buffer.from(JSON.stringify(metric))
						}))
					}
				))
			);
		} catch(err) {
			return this._retryAdd(attempts, metricsBatches, err.message);
		}

		const metricsFailed = metricPromises.reduce((accum, metricPromise, index) => {

			if(metricPromise?.reason)
				accum.push(metricsBatches[index]);

			return accum;
		}, []);

		if(metricsFailed.length)
			return this._retryAdd(attempts, metricsFailed, metricPromises.find(promise => promise?.reason).reason);
	}

	static _retryAdd(attempts, batches, lastErrorMessage) {

		attempts++;

		return attempts >= MAX_ATTEMPTS
			? emitter.emit('create-error', batches,
				new MetricError(`Unable to put the metrics into firehose, max attempts reached: ${lastErrorMessage}`, MetricError.codes.FIREHOSE_ERROR))
			: this._add(batches, attempts);
	}
};
