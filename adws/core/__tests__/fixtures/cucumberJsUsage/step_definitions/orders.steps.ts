import { Given, Then, When } from '@cucumber/cucumber';

Given('the shop is open', function () {});
When('a customer orders {int} {string}', function (_count: number, _item: string) {});
Then('the order is accepted', function () {});
Then('the order is rejected', function () {});
Given(/^the shop closes at (\d+)$/, function (_hour: string) {});
