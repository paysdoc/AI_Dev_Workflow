package fixture.steps;

import io.cucumber.java.en.Given;
import io.cucumber.java.en.Then;
import io.cucumber.java.en.When;

public class OrderSteps {
    public OrderSteps() {}

    @Given("the shop is open")
    public void theShopIsOpen() {}

    @When("a customer orders {int} {string}")
    public void aCustomerOrders(int count, String item) {}

    @Then("the order is accepted")
    public void theOrderIsAccepted() {}

    @Then("the order is rejected")
    public void theOrderIsRejected() {}

    @Given("^the shop closes at (\\d+)$")
    public void theShopClosesAt(String hour) {}
}
