# metric

![Build Status](https://github.com/janis-commerce/log/workflows/Build%20Status/badge.svg)
[![Coverage Status](https://coveralls.io/repos/github/janis-commerce/log/badge.svg?branch=master)](https://coveralls.io/github/janis-commerce/log?branch=master)
[![npm version](https://badge.fury.io/js/%40janiscommerce%2Flog.svg)](https://www.npmjs.com/package/@janiscommerce/log)

A package for creating metrics in Firehose

## Installation
```sh
npm install @janiscommerce/metric
```

## Configuration
### ENV variables
**`JANIS_SERVICE_NAME`** (required): The name of the service that will create the metric.
**`JANIS_ENV`** (required): The stage name that will used as prefix for trace firehose delivery stream.
**`METRIC_ROLE_ARN`** (required): The ARN to assume the trace role in order to put records in Firehose.

## API
### **`add(clientCode, metrics)`**
Parameters: `clientCode [String]`, `metrics [Object] or [Object array]`
Puts the recieved metric or metrics into the janis-trace-firehose

### Metric structure
The `metric [Object]` parameter have the following structure:
- **`id [String]`** (optional): The ID of the log in UUID V4 format. Default will be auto-generated.
- **`service [String]`** (optional): The service name, if this field not exists, will be obtained from the ENV (**`JANIS_SERVICE_NAME`**)
- **`name [String]`** (optional): A reference name for the metric
- **`metric [Object|Array]`** (optional): This property is a JSON that includes all the technical data about your metric.

### Metric example
```js
{
	id: '0acefd5e-cb90-4531-b27a-e4d236f07539',
	service: 'oms',
	name: 'order-fulfillment-status',
	metric: {
		warehouseName: "Example Warehouse name",
		salesChannelId: "d555345345345as67a342a",
		salesChannelName: "Example Sales Channel name",
		pending: 4,
		picking: 2,
		picked: 5,
	},
	date_created: 1559103066
}
```

### **`on(event, callback)`**
Parameters: `event [String]`, `callback [Function]`
Calls a callback when the specified event is emitted.

## Errors

The errors are informed with a `LogError`.
This object has a code that can be useful for a correct error handling.
The codes are the following:

| Code | Description                    |
|------|--------------------------------|
| 1    | Invalid metric                 |
| 2    | Firehose Error                 |
| 3    | Unknown stage name             |

- In case of error while sending your metrics to Firehose, this package will emit an event called `create-error`, you can handle it using the `on()` method.

## Usage
```js
const Metric = require('@janiscommerce/metric');

// Single metric send
await Metric.add('some-client', {
	service: 'oms',
	name: 'order-fulfillment-status',
	metric: {
		warehouseName: "Example Warehouse name",
		salesChannelId: "d555345345345as67a342a",
		salesChannelName: "Example Sales Channel name",
		pending: 4,
		picking: 2,
		picked: 5
	}
});

// Multiple metrics send
await Metric.add('some-client', [
	{
		service: 'oms',
		name: 'order-fulfillment-status',
		metric: {
			warehouseName: "Example Warehouse name",
			salesChannelId: "629d269fbd8f5f5da8185ba3",
			salesChannelName: "Example Sales Channel name",
			picked: 5
		}
	},
	{
		service: 'oms',
		name: 'order-fulfillment-status',
		metric: {
			warehouseName: "Other Example Warehouse name",
			salesChannelId: "629d26a36c3c06aefe297df2",
			salesChannelName: "Other Example Sales Channel name",
			picking: 3
		}
	}
]);

// Metric creation error handling
Metric.on('create-error', (metric, err) => {
	console.error(`An error occurred while creating the metric ${err.message}`);
});

### Serverless configuration

Returns an array with the hooks needed for Metric's serverless configuration according to [Serverless Helper](https://www.npmjs.com/package/sls-helper-plugin-janis). In `path/to/root/serverless.js` add:

```js
'use strict';

const { helper } = require('sls-helper'); // eslint-disable-line
const functions = require('./serverless/functions.json');
const Metric = require('@janiscommerce/metric');

module.exports = helper({
	hooks: [
		// other hooks
        ...functions,
        ...Metric.serverlessConfiguration
	]
});
```