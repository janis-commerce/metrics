'use strict';

const assert = require('assert');
const sinon = require('sinon');
const Settings = require('@janiscommerce/settings');

const FirehoseWrapper = require('../lib/aws-wrappers/firehose');
const STSWrapper = require('../lib/aws-wrappers/sts');

const Metric = require('../lib/metric');

describe('Metric', () => {

	const fakeMetricName = 'some-name';

	const fakeMetricData = {
		some: 'metric'
	};

	const expectedMetric = {
		clientCode: 'some-client',
		metricName: fakeMetricName,
		metricData: fakeMetricData
	};

	const fakeRole = {
		Credentials: {
			AccessKeyId: 'some-access-key-id',
			SecretAccessKey: 'some-secret-access-key',
			SessionToken: 'some-session-token'
		},
		Expiration: '2022-01-27T21:07:21.177'
	};

	const clearCaches = () => {
		delete Metric._credentialsExpiration; // eslint-disable-line no-underscore-dangle
		delete Metric._firehose; // eslint-disable-line no-underscore-dangle
	};

	let fakeTime = null;

	beforeEach(() => {
		fakeTime = sinon.useFakeTimers(new Date());
	});

	afterEach(() => {
		clearCaches();
		sinon.restore();
	});

	describe('add', () => {

		it('Should send metrics to Firehose and cache the assumed role credentials', async () => {

			sinon.stub(STSWrapper.prototype, 'assumeRole')
				.resolves({ ...fakeRole, Expiration: new Date().toISOString() });

			sinon.stub(FirehoseWrapper.prototype, 'putRecordBatch')
				.resolves();

			await Metric.add('some-client', fakeMetricName, fakeMetricData);

			await Metric.add('other-client', fakeMetricName, fakeMetricData);

			sinon.assert.calledTwice(FirehoseWrapper.prototype.putRecordBatch);

			sinon.assert.calledWithExactly(FirehoseWrapper.prototype.putRecordBatch.getCall(0), {
				DeliveryStreamName: 'kpi-metrics-per-client',
				Records: [
					{
						Data: Buffer.from(JSON.stringify({ ...expectedMetric, dateCreated: new Date() }))
					}
				]
			});
			sinon.assert.calledWithExactly(FirehoseWrapper.prototype.putRecordBatch.getCall(1), {
				DeliveryStreamName: 'kpi-metrics-per-client',
				Records: [
					{
						Data: Buffer.from(JSON.stringify({ ...expectedMetric, clientCode: 'other-client', dateCreated: new Date() }))
					}
				]
			});

			sinon.assert.calledOnceWithExactly(STSWrapper.prototype.assumeRole, {
				RoleArn: 'some-role-arn',
				RoleSessionName: 'default-service',
				DurationSeconds: 1800
			});
		});

		it('Should split the received metrics into batches of 500 metrics', async () => {

			sinon.stub(STSWrapper.prototype, 'assumeRole')
				.resolves({ ...fakeRole, Expiration: new Date().toISOString() });

			sinon.stub(FirehoseWrapper.prototype, 'putRecordBatch')
				.resolves();

			await Metric.add('some-client', fakeMetricName, Array(1250).fill(fakeMetricData));

			sinon.assert.calledThrice(FirehoseWrapper.prototype.putRecordBatch);
			sinon.assert.calledOnce(STSWrapper.prototype.assumeRole);
		});

		it('Should not send the metric to Firehose when the env is local', async () => {

			sinon.stub(process.env, 'JANIS_ENV').value('local');

			sinon.spy(STSWrapper.prototype, 'assumeRole');
			sinon.spy(FirehoseWrapper.prototype, 'putRecordBatch');

			await Metric.add('some-client', fakeMetricName, fakeMetricData);

			sinon.assert.notCalled(STSWrapper.prototype.assumeRole);
			sinon.assert.notCalled(FirehoseWrapper.prototype.putRecordBatch);
		});

		it('Should get new role credentials when the previous ones expires', async () => {

			sinon.stub(STSWrapper.prototype, 'assumeRole')
				.resolves({ ...fakeRole, Expiration: new Date().toISOString() });

			sinon.stub(FirehoseWrapper.prototype, 'putRecordBatch')
				.resolves();

			await Metric.add('some-client', fakeMetricName, fakeMetricData);

			fakeTime.tick(1900000); // more than 30 min

			await Metric.add('other-client', fakeMetricName, fakeMetricData);

			sinon.assert.calledTwice(FirehoseWrapper.prototype.putRecordBatch);

			sinon.assert.calledTwice(STSWrapper.prototype.assumeRole);
			sinon.assert.calledWithExactly(STSWrapper.prototype.assumeRole.getCall(0), {
				RoleArn: 'some-role-arn',
				RoleSessionName: 'default-service',
				DurationSeconds: 1800
			});
			sinon.assert.calledWithExactly(STSWrapper.prototype.assumeRole.getCall(1), {
				RoleArn: 'some-role-arn',
				RoleSessionName: 'default-service',
				DurationSeconds: 1800
			});
		});

		it('Should send a metric to Firehose and not get credentials if there are no Role ARN ENV', async () => {

			sinon.stub(process.env, 'METRIC_ROLE_ARN').value('');

			sinon.spy(STSWrapper.prototype, 'assumeRole');

			sinon.stub(FirehoseWrapper.prototype, 'putRecordBatch')
				.resolves();

			await Metric.add('some-client', fakeMetricName, fakeMetricData);

			sinon.assert.calledOnce(FirehoseWrapper.prototype.putRecordBatch);

			sinon.assert.notCalled(STSWrapper.prototype.assumeRole);
		});

		it('Should retry when Firehose fails', async () => {

			sinon.stub(STSWrapper.prototype, 'assumeRole')
				.resolves({ ...fakeRole, Expiration: new Date().toISOString() });

			sinon.stub(FirehoseWrapper.prototype, 'putRecordBatch');

			FirehoseWrapper.prototype.putRecordBatch.onFirstCall()
				.rejects();

			FirehoseWrapper.prototype.putRecordBatch.onSecondCall()
				.resolves();

			await Metric.add('some-client', fakeMetricName, fakeMetricData);

			sinon.assert.calledTwice(FirehoseWrapper.prototype.putRecordBatch);
			sinon.assert.alwaysCalledWithExactly(FirehoseWrapper.prototype.putRecordBatch, {
				DeliveryStreamName: 'kpi-metrics-per-client',
				Records: [
					{
						Data: Buffer.from(JSON.stringify({ ...expectedMetric, dateCreated: new Date() }))
					}
				]
			});

			sinon.assert.calledOnceWithExactly(STSWrapper.prototype.assumeRole, {
				RoleArn: 'some-role-arn',
				RoleSessionName: 'default-service',
				DurationSeconds: 1800
			});
		});

		it('Should retry when Firehose fails and emit the create-error event when max retries reached', async () => {

			sinon.stub(STSWrapper.prototype, 'assumeRole')
				.resolves({ ...fakeRole, Expiration: new Date().toISOString() });

			sinon.stub(FirehoseWrapper.prototype, 'putRecordBatch')
				.rejects();

			let errorEmitted = false;

			Metric.on('create-error', () => {
				errorEmitted = true;
			});

			await Metric.add('some-client', fakeMetricName, fakeMetricData);

			assert.deepStrictEqual(errorEmitted, true);

			sinon.assert.calledThrice(FirehoseWrapper.prototype.putRecordBatch);
			sinon.assert.alwaysCalledWithExactly(FirehoseWrapper.prototype.putRecordBatch, {
				DeliveryStreamName: 'kpi-metrics-per-client',
				Records: [
					{
						Data: Buffer.from(JSON.stringify({ ...expectedMetric, dateCreated: new Date() }))
					}
				]
			});

			sinon.assert.calledOnceWithExactly(STSWrapper.prototype.assumeRole, {
				RoleArn: 'some-role-arn',
				RoleSessionName: 'default-service',
				DurationSeconds: 1800
			});
		});

		it('Should not call Firehose putRecordBatch when assume role rejects', async () => {

			sinon.stub(STSWrapper.prototype, 'assumeRole')
				.rejects();

			sinon.spy(FirehoseWrapper.prototype, 'putRecordBatch');

			await Metric.add('some-client', fakeMetricName, fakeMetricData);

			sinon.assert.notCalled(FirehoseWrapper.prototype.putRecordBatch);
		});

		it('Should not call Firehose putRecordBatch when assume role returns an invalid result', async () => {

			sinon.stub(STSWrapper.prototype, 'assumeRole')
				.resolves(null);

			sinon.spy(FirehoseWrapper.prototype, 'putRecordBatch');

			await Metric.add('some-client', fakeMetricName, fakeMetricData);

			sinon.assert.notCalled(FirehoseWrapper.prototype.putRecordBatch);
		});

		context('When the received metric is invalid', () => {

			[

				{ clientCode: expectedMetric.clientCode, metricName: fakeMetricName, metricData: 'not an object/array' },
				{ clientCode: expectedMetric.clientCode, metricName: { not: 'a string' }, metricData: fakeMetricData },
				{ clientCode: ['not a string'], metricName: fakeMetricName, metricData: fakeMetricData }

			].forEach(({ clientCode, metricName, metricData }) => {

				it('Should throw and not try to send the metric to Firehose', async () => {

					sinon.spy(STSWrapper.prototype, 'assumeRole');
					sinon.spy(FirehoseWrapper.prototype, 'putRecordBatch');

					await Metric.add(clientCode, metricName, metricData);

					sinon.assert.notCalled(STSWrapper.prototype.assumeRole);
					sinon.assert.notCalled(FirehoseWrapper.prototype.putRecordBatch);
				});
			});
		});

	});

	context('Serverless configuration getter', () => {

		it('Should return the serverless hooks', () => {

			sinon.stub(Settings, 'get').returns('metricArnSource');

			assert.deepStrictEqual(Metric.serverlessConfiguration, [
				['envVars', {
					METRIC_ROLE_ARN: 'metricArnSource'
				}], ['iamStatement', {
					action: 'Sts:AssumeRole',
					resource: 'metricArnSource'
				}]
			]);

			sinon.assert.calledOnceWithExactly(Settings.get, 'metricRoleArn');
		});
	});
});
