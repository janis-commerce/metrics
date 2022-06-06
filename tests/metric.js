'use strict';

const assert = require('assert');
const sinon = require('sinon');
const Settings = require('@janiscommerce/settings');

const { STS, Firehose } = require('../lib/aws-wrappers');

const Metric = require('../lib');

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
		delete Metric._deliveryStreamName; // eslint-disable-line no-underscore-dangle
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

			sinon.stub(STS.prototype, 'assumeRole')
				.resolves({ ...fakeRole, Expiration: new Date().toISOString() });

			sinon.stub(Firehose.prototype, 'putRecordBatch')
				.resolves();

			await Metric.add('some-client', fakeMetricName, fakeMetricData);

			await Metric.add('other-client', fakeMetricName, fakeMetricData);

			sinon.assert.calledTwice(Firehose.prototype.putRecordBatch);

			sinon.assert.calledWithExactly(Firehose.prototype.putRecordBatch.getCall(0), {
				DeliveryStreamName: 'kpi-metrics-per-client-beta',
				Records: [
					{
						Data: Buffer.from(JSON.stringify({ ...expectedMetric, dateCreated: new Date() }))
					}
				]
			});
			sinon.assert.calledWithExactly(Firehose.prototype.putRecordBatch.getCall(1), {
				DeliveryStreamName: 'kpi-metrics-per-client-beta',
				Records: [
					{
						Data: Buffer.from(JSON.stringify({ ...expectedMetric, clientCode: 'other-client', dateCreated: new Date() }))
					}
				]
			});

			sinon.assert.calledOnceWithExactly(STS.prototype.assumeRole, {
				RoleArn: 'some-role-arn',
				RoleSessionName: 'default-service',
				DurationSeconds: 1800
			});
		});

		it('Should split the received metrics into batches of 500 metrics', async () => {

			sinon.stub(STS.prototype, 'assumeRole')
				.resolves({ ...fakeRole, Expiration: new Date().toISOString() });

			sinon.stub(Firehose.prototype, 'putRecordBatch')
				.resolves();

			await Metric.add('some-client', fakeMetricName, Array(1250).fill(fakeMetricData));

			sinon.assert.calledThrice(Firehose.prototype.putRecordBatch);
			sinon.assert.calledOnce(STS.prototype.assumeRole);
		});

		it('Should not send the metric to Firehose when the env is local', async () => {

			sinon.stub(process.env, 'JANIS_ENV').value('local');

			sinon.spy(STS.prototype, 'assumeRole');
			sinon.spy(Firehose.prototype, 'putRecordBatch');

			await Metric.add('some-client', fakeMetricName, fakeMetricData);

			sinon.assert.notCalled(STS.prototype.assumeRole);
			sinon.assert.notCalled(Firehose.prototype.putRecordBatch);
		});

		it('Should get new role credentials when the previous ones expires', async () => {

			sinon.stub(STS.prototype, 'assumeRole')
				.resolves({ ...fakeRole, Expiration: new Date().toISOString() });

			sinon.stub(Firehose.prototype, 'putRecordBatch')
				.resolves();

			await Metric.add('some-client', fakeMetricName, fakeMetricData);

			fakeTime.tick(1900000); // more than 30 min

			await Metric.add('other-client', fakeMetricName, fakeMetricData);

			sinon.assert.calledTwice(Firehose.prototype.putRecordBatch);

			sinon.assert.calledTwice(STS.prototype.assumeRole);
			sinon.assert.calledWithExactly(STS.prototype.assumeRole.getCall(0), {
				RoleArn: 'some-role-arn',
				RoleSessionName: 'default-service',
				DurationSeconds: 1800
			});
			sinon.assert.calledWithExactly(STS.prototype.assumeRole.getCall(1), {
				RoleArn: 'some-role-arn',
				RoleSessionName: 'default-service',
				DurationSeconds: 1800
			});
		});

		it('Should send a metric to Firehose and not get credentials if there are no Role ARN ENV', async () => {

			sinon.stub(process.env, 'METRIC_ROLE_ARN').value('');

			sinon.spy(STS.prototype, 'assumeRole');

			sinon.stub(Firehose.prototype, 'putRecordBatch')
				.resolves();

			await Metric.add('some-client', fakeMetricName, fakeMetricData);

			sinon.assert.calledOnce(Firehose.prototype.putRecordBatch);

			sinon.assert.notCalled(STS.prototype.assumeRole);
		});

		it('Should retry when Firehose fails', async () => {

			sinon.stub(STS.prototype, 'assumeRole')
				.resolves({ ...fakeRole, Expiration: new Date().toISOString() });

			sinon.stub(Firehose.prototype, 'putRecordBatch');

			Firehose.prototype.putRecordBatch.onFirstCall()
				.rejects();

			Firehose.prototype.putRecordBatch.onSecondCall()
				.resolves();

			await Metric.add('some-client', fakeMetricName, fakeMetricData);

			sinon.assert.calledTwice(Firehose.prototype.putRecordBatch);
			sinon.assert.alwaysCalledWithExactly(Firehose.prototype.putRecordBatch, {
				DeliveryStreamName: 'kpi-metrics-per-client-beta',
				Records: [
					{
						Data: Buffer.from(JSON.stringify({ ...expectedMetric, dateCreated: new Date() }))
					}
				]
			});

			sinon.assert.calledOnceWithExactly(STS.prototype.assumeRole, {
				RoleArn: 'some-role-arn',
				RoleSessionName: 'default-service',
				DurationSeconds: 1800
			});
		});

		it('Should retry when Firehose fails and emit the create-error event when max retries reached', async () => {

			sinon.stub(process.env, 'JANIS_ENV')
				.value('qa');

			sinon.stub(STS.prototype, 'assumeRole')
				.resolves({ ...fakeRole, Expiration: new Date().toISOString() });

			sinon.stub(Firehose.prototype, 'putRecordBatch')
				.rejects();

			let errorEmitted = false;

			Metric.on('create-error', () => {
				errorEmitted = true;
			});

			await Metric.add('some-client', fakeMetricName, fakeMetricData);

			assert.deepStrictEqual(errorEmitted, true);

			sinon.assert.calledThrice(Firehose.prototype.putRecordBatch);
			sinon.assert.alwaysCalledWithExactly(Firehose.prototype.putRecordBatch, {
				DeliveryStreamName: 'kpi-metrics-per-client-qa',
				Records: [
					{
						Data: Buffer.from(JSON.stringify({ ...expectedMetric, dateCreated: new Date() }))
					}
				]
			});

			sinon.assert.calledOnceWithExactly(STS.prototype.assumeRole, {
				RoleArn: 'some-role-arn',
				RoleSessionName: 'default-service',
				DurationSeconds: 1800
			});
		});

		it('Should not call Firehose putRecordBatch when ENV stage variable not exists', async () => {

			sinon.stub(process.env, 'JANIS_ENV').value('');

			sinon.stub(STS.prototype, 'assumeRole')
				.resolves(fakeRole);

			sinon.spy(Firehose.prototype, 'putRecordBatch');

			await Metric.add('some-client', fakeMetricName, fakeMetricData);

			sinon.assert.notCalled(Firehose.prototype.putRecordBatch);
		});

		it('Should not call Firehose putRecordBatch when assume role rejects', async () => {

			sinon.stub(STS.prototype, 'assumeRole')
				.rejects();

			sinon.spy(Firehose.prototype, 'putRecordBatch');

			await Metric.add('some-client', fakeMetricName, fakeMetricData);

			sinon.assert.notCalled(Firehose.prototype.putRecordBatch);
		});

		it('Should not call Firehose putRecordBatch when assume role returns an invalid result', async () => {

			sinon.stub(STS.prototype, 'assumeRole')
				.resolves(null);

			sinon.spy(Firehose.prototype, 'putRecordBatch');

			await Metric.add('some-client', fakeMetricName, fakeMetricData);

			sinon.assert.notCalled(Firehose.prototype.putRecordBatch);
		});

		context('When the received metric is invalid', () => {

			[

				{ clientCode: expectedMetric.clientCode, metricName: fakeMetricName, metricData: 'not an object/array' },
				{ clientCode: expectedMetric.clientCode, metricName: { not: 'a string' }, metricData: fakeMetricData },
				{ clientCode: ['not a string'], metricName: fakeMetricName, metricData: fakeMetricData }

			].forEach(({ clientCode, metricName, metricData }) => {

				it('Should throw and not try to send the metric to Firehose', async () => {

					sinon.spy(STS.prototype, 'assumeRole');
					sinon.spy(Firehose.prototype, 'putRecordBatch');

					await Metric.add(clientCode, metricName, metricData);

					sinon.assert.notCalled(STS.prototype.assumeRole);
					sinon.assert.notCalled(Firehose.prototype.putRecordBatch);
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
