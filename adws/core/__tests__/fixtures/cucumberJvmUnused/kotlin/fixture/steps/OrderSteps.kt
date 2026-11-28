package fixture.steps

import io.cucumber.java.en.Given
import io.cucumber.java.en.Then
import io.cucumber.java.en.When

class OrderSteps {
    @Given("the shop is open")
    fun theShopIsOpen() {}

    @When("a customer orders {int} {string}")
    fun aCustomerOrders(count: Int, item: String) {}

    @Then("the order is accepted")
    fun theOrderIsAccepted() {}

    @Then("the order is rejected")
    fun theOrderIsRejected() {}

    @Given("^the shop closes at (\\d+)$")
    fun theShopClosesAt(hour: String) {}
}
