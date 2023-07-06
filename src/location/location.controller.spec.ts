import { Test } from '@nestjs/testing';
import { ConfigService } from '@sierralabs/nest-utils';
import { startOfWeek, startOfYear } from 'date-fns';
import * as _ from 'lodash';
import timekeeper from 'timekeeper';
import faker from 'faker';

import { AppModule } from '../app.module';
import { SearchValidationPipe } from '../common/pipes/search-validation.pipe';
import { LocationSearchDto, PricingType } from './dto/location-search.dto';
import { Location } from './../entities/location.entity';
import { LocationRating } from './../entities/location-rating.entity';
import { LocationHour } from '../entities/location-hour.entity';
import { MobileCheckIn } from '../entities/mobile-check-in.entity';
import { User } from './../entities/user.entity';
import { HoursService } from './hours/hours.service';
import { LocationController } from './location.controller';
import { LocationExceptions } from './location.exceptions';
import { LocationService } from './location.service';
import { MobileCheckInDto } from '../mobile-check-in/mobile-check-in.dto';
import { MobileCheckInService } from '../mobile-check-in/mobile-check-in.service';
import { OrganizationService } from '../organization/organization.service';
import { UserService } from '../user/user.service';
import { OrganizationExceptions } from '../organization/organization.exceptions';
import { UserLocationExceptions } from '../user-location/user-location.exceptions';
import { Product } from '../entities/product.entity';
import { FixtureService } from '../../test/utils/fixture.service';
import { UpdateProductDto } from './dto/update-product.dto';
import { TestUtilsModule } from '../../test/utils/test-utils.module';
import { UserLocationService } from '../user-location/user-location.service';

describe('LocationController', () => {
  let locationController: LocationController;
  let locationService: LocationService;
  let hoursService: HoursService;
  let userService: UserService;
  let organizationService: OrganizationService;
  let configService: ConfigService;
  let mobileCheckInService: MobileCheckInService;
  let userLocationService: UserLocationService;
  let fixtureService: FixtureService;

  // ISBX coords
  const userLocation = {
    lat: 34.020575,
    lng: -118.424138,
  };
  // default bounds centering in "user location": ISBX
  const mapBounds = {
    maxLat: 33.9585,
    maxLong: -118.5323,
    minLat: 34.0826,
    minLong: -118.316,
  };
  let admin, user, siteAdmin;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule, TestUtilsModule],
    }).compile();

    locationController = module.get<LocationController>(LocationController);
    locationService = module.get<LocationService>(LocationService);
    hoursService = module.get<HoursService>(HoursService);
    userService = module.get<UserService>(UserService);
    organizationService = module.get<OrganizationService>(OrganizationService);
    configService = module.get<ConfigService>(ConfigService);
    mobileCheckInService = module.get<MobileCheckInService>(
      MobileCheckInService,
    );
    userLocationService = module.get<UserLocationService>(UserLocationService);
    fixtureService = module.get<FixtureService>(FixtureService);
  });

  describe('Location Unit Tests', () => {
    let newLocation;
    beforeAll(async () => {
      // Admin Role
      admin = await userService.findByEmail('gd_admin@isbx.com');

      // Site Admin Role
      siteAdmin = await userService.findByEmail('user+e2e@isbx.com');

      const ts = +new Date(); // force milliseconds
      const info = {
        ...new User(),
        ...{
          firstName: `User${ts}`,
          lastName: `Testbot`,
          email: `user${ts}@isbx.com`,
          password: `password`,
        },
      };
      user = await userService.register(info);
    });

    it('should create location', async () => {
      const organizations = await organizationService.findWithFilter();
      const ts = +new Date(); // force milliseconds
      const info = {
        name: `Location${ts}`,
        organization: organizations[0][0],
        longLat: '(-66.1204234000000024,18.291058300000001)',
        timezone: 'America/Los_Angeles',
        addressLine1: '123 Santa Anna Blvd',
        city: 'Los Angeles',
        state: { id: 5 },
        postalCode: '90067',
      } as Location;
      newLocation = await locationService.create(info);
      expect(newLocation.id).toBeTruthy();
    });

    it('should delete location', async () => {
      const organizations = await organizationService.findWithFilter();
      const info = {
        name: `DeletedLocation`,
        organization: organizations[0][0],
        longLat: '(-66.1204234000000026,18.291058300000006)',
        timezone: 'America/Los_Angeles',
        addressLine1: '123 Santa Anna Blvd',
        city: 'Los Angeles',
        state: { id: 5 },
        postalCode: '90067',
      } as Location;
      newLocation = await locationService.create(info);
      const locationId = newLocation.id;
      expect(locationId).toBeTruthy(); // Confirm if new location was created
      expect(newLocation.deleted).toBeFalsy; // Confirm if new location status is not deleted

      await locationService.remove(locationId, admin.id);

      const deletedLocation = await locationService.findById(locationId, true);
      expect(deletedLocation.deleted).toBeTruthy; // Confirm if new location was deleted
    });

    it('should include deleted location', async () => {
      const locations = await locationService.findWithFilter({
        search: 'DeletedLocation',
        limit: 10,
        includeDeleted: true,
      });
      const hasDeletedLocations = locations[0].find(
        location => location.deleted,
      );
      expect(!!hasDeletedLocations).toBeTruthy();
    });

    it('should not fetch deleted location', async () => {
      const activeLocations = await locationService.findWithFilter({
        search: 'DeletedLocation',
        limit: 10,
        includeDeleted: false,
      });
      const hasDeletedLocations = activeLocations[0].find(
        location => location.deleted,
      );
      expect(!!hasDeletedLocations).toBeFalsy();
    });

    it('should search by text', async () => {
      const results = await locationController.search('(e2e location test)');
      expect(results).toBeInstanceOf(Array);
      expect(results[0]).toBeInstanceOf(Array);
      expect(results[0].length).toBeGreaterThan(0);
    });

    it('should search by lat/long', async () => {
      const results = await locationController.search(
        '',
        34.021851,
        -118.426275,
        34.019086,
        -118.421937,
      );
      expect(results).toBeInstanceOf(Array);
      expect(results[0]).toBeInstanceOf(Array);
      expect(results[0].length).toBe(2);
    });

    it('should return locations hours per location', async () => {
      const results = await locationController.search('ISBX');
      const location = results[0][0];
      // Confirm results format
      expect(results).toBeInstanceOf(Array);
      expect(results[0]).toBeInstanceOf(Array);
      expect(location.id).not.toBeFalsy();

      // Confirm location hours
      expect(location.hours).toBeInstanceOf(Array);
      expect(location.hours.length).toBeGreaterThan(0);
    });

    it('should return location hours today status', async () => {
      /**
       * this unit test assumes the timezone is set to UTC
       * run test with TZ=UTC parameter
       */
      // Use new year date as baseline for time for consistency
      const newYear = startOfYear(new Date());

      const results = await locationController.search('ISBX');
      // tz=America/Los_Angeles, start=00:00, end=11:55 (see location.mock.ts)
      const location = results[0][0];
      const openTime = startOfWeek(newYear, { weekStartsOn: 1 });
      const closedTime = startOfWeek(newYear, { weekStartsOn: 2 });

      // 12:00 PM in Los_Angeles
      openTime.setHours(12 + 8); // UTC 8 PM = 1:00 PM in LA
      timekeeper.freeze(openTime);

      const hoursTodayOpen = hoursService.getHoursToday(location as Location);
      expect(hoursTodayOpen.isOpen).toBeTruthy();

      // 7:57:30 AM next day = 11:57:30 PM in Los_Angeles
      closedTime.setHours(7);
      closedTime.setMinutes(57);
      closedTime.setSeconds(30);

      timekeeper.travel(closedTime);
      const hoursTodayClosed = hoursService.getHoursToday(location as Location);
      expect(hoursTodayClosed.isOpen).toEqual(false);

      timekeeper.reset();
    });

    it('should sort nearest to user location if provided', async () => {
      // Expected - Nearest order based on coordinates
      const expectedOrder = ['ISBX', 'CVS', 'Burger King', 'Westfield Century']; // dependent on mock data's longLat
      const limit = expectedOrder.length;
      const results = await locationController.search(
        '',
        mapBounds.minLat,
        mapBounds.minLong,
        mapBounds.maxLat,
        mapBounds.maxLong,
        null,
        limit,
        null,
        null,
        userLocation.lat,
        userLocation.lng,
      );
      expect(results[1]).toBe(limit); // has results

      const actualOrder = results[0];
      // match the order
      for (let i = 0; i < actualOrder.length; i++) {
        const expectedName = expectedOrder[i];
        expect(actualOrder[i].name.substr(0, expectedName.length)).toBe(
          expectedName,
        );
      }
    });

    it('should not sort nearest to user location if order provided', async () => {
      // Expected - Nearest order based on coordinates
      const orderedNearest = [
        'ISBX',
        'CVS',
        'Burger King',
        'Westfield Century',
      ]; // dependent on mock data's longLat
      const limit = orderedNearest.length;

      const results = await locationController.search(
        '',
        mapBounds.minLat,
        mapBounds.minLong,
        mapBounds.maxLat,
        mapBounds.maxLong,
        null,
        limit,
        new SearchValidationPipe(Location).transformOrder('name ASC'),
        null,
      ); // order by name
      expect(results[1]).toBe(limit); // has results

      const actualOrdering = results[0];
      // compare by concat
      const concatExpected = orderedNearest.join('');
      let concatActual = '';
      for (let i = 0; i < actualOrdering.length; i++) {
        concatActual += actualOrdering[i].name.substr(
          0,
          orderedNearest[i].length,
        );
      }
      expect(concatActual).not.toBe(concatExpected);
    });

    it('should return only in-stock products by default', async () => {
      const locations = await locationService.findWithFilter({
        search: 'ISBX',
      }); // mock location - "ISBX (e2e)"
      const locationId = locations[0][0].id;
      const productResponse = await locationController.getProducts(
        locationId,
        '',
        null,
        null,
        '',
      );
      expect(productResponse[1]).toBeGreaterThan(0);
      productResponse[0].forEach(product => {
        expect(product.isInStock).toBeTruthy();
      });
    });

    it('should return out-stock products if requested', async () => {
      const locations = await locationService.findWithFilter({
        search: 'ISBX',
      }); // mock location - "ISBX (e2e)"
      const locationId = locations[0][0].id;
      const productResponse = await locationController.getProducts(
        locationId,
        '',
        null,
        null,
        '',
        true, // return all products
      );
      expect(productResponse[1]).toBeGreaterThan(0);
      let outOfStockCount = 0;
      productResponse[0].forEach(product => {
        if (!product.isInStock) outOfStockCount++;
      });
      expect(outOfStockCount).toBeGreaterThan(0);
    });

    it('should not include hidden products by default', async () => {
      const locations = await locationService.findWithFilter({
        search: 'ISBX',
      }); // mock location - "ISBX (e2e)"
      const locationId = locations[0][0].id;
      const productResponse = await locationController.getProducts(locationId);
      productResponse[0].forEach(product => {
        expect(product.hidden).toBeFalsy();
      });
    });

    it('should return hidden products if requested', async () => {
      const INCLUDE_HIDDEN = true;
      const locations = await locationService.findWithFilter({
        search: 'ISBX',
      }); // mock location - "ISBX (e2e)"
      const locationId = locations[0][0].id;
      const productResponse = await locationController.getProducts(
        locationId,
        '',
        null,
        null,
        '',
        false,
        null,
        INCLUDE_HIDDEN,
      );
      expect(productResponse[1]).toBeGreaterThan(0);
      let hiddenProductsCount = 0;
      productResponse[0].forEach(product => {
        if (product.hidden) hiddenProductsCount++;
      });
      expect(hiddenProductsCount).toBeGreaterThan(0);
    });

    it('should add review', async () => {
      const locations = await locationService.findWithFilter({
        search: 'ISBX',
      });

      const rating = new LocationRating();
      rating.location = new Location();
      rating.user = new User();
      rating.location.id = locations[0][0].id;
      rating.user.id = user.id;
      rating.firstName = user.firstName;
      rating.lastName = user.lastName;
      rating.review = 'Test review ISBX';
      rating.rating = 5;

      await locationService.createReview(rating);

      const reviews = await locationService.getReviews(locations[0][0].id);
      expect(reviews[0].length).toBeGreaterThan(0);
      const result = _.find(reviews[0], {
        firstName: user.firstName,
        lastName: user.lastName,
        review: 'Test review ISBX',
        rating: 5,
      });
      expect(result).toBeTruthy();
    });

    it('should get a review with a NULL review value', async () => {
      const organizations = await organizationService.findWithFilter();
      const ts = +new Date(); // force milliseconds
      const info = {
        name: `Location${ts}`,
        organization: organizations[0][0],
        longLat: '(-66.1204234000000024,18.291058300000001)',
        timezone: 'America/Los_Angeles',
        addressLine1: '123 Santa Anna Blvd',
        city: 'Los Angeles',
        state: { id: 5 },
        postalCode: '90067',
      } as Location;
      const addedLocation = await locationService.create(info);

      const rating = new LocationRating();
      rating.location = new Location();
      rating.user = new User();
      rating.location.id = addedLocation.id;
      rating.user.id = user.id;
      rating.firstName = user.firstName;
      rating.lastName = user.lastName;
      rating.rating = 5;

      const addedReview = await locationService.createReview(rating, true);
      const review = await locationService.getReview(
        addedLocation.id,
        addedReview.id,
      );

      expect(review.review).toBeNull();
    });

    it('should get all reviews of a location', async () => {
      const organizations = await organizationService.findWithFilter();
      const ts = +new Date(); // force milliseconds
      const info = {
        name: `Location${ts}`,
        organization: organizations[0][0],
        longLat: '(-66.1204234000000024,18.291058300000001)',
        timezone: 'America/Los_Angeles',
        addressLine1: '123 Santa Anna Blvd',
        city: 'Los Angeles',
        state: { id: 5 },
        postalCode: '90067',
      } as Location;
      const addedLocation = await locationService.create(info);

      const rating = new LocationRating();
      rating.location = new Location();
      rating.user = new User();
      rating.location.id = addedLocation.id;
      rating.user.id = user.id;
      rating.firstName = user.firstName;
      rating.lastName = user.lastName;
      rating.rating = 5;
      await locationService.createReview(rating, true);

      rating.review = 'Test review ISBX';
      await locationService.createReview(rating, true);

      const reviews = await locationService.getReviews(addedLocation.id);
      const location = await locationService.findById(addedLocation.id);

      expect(reviews[0]).toBeInstanceOf(Array);
      expect(reviews[0].length).toEqual(+location.ratingCount);
    });

    it('should get all hours of a location', async () => {
      const locations = await locationService.findWithFilter({
        search: 'ISBX',
      });
      const result = await hoursService.getLocationHours(locations[0][0].id);
      expect(result).toBeInstanceOf(Array);
      expect(result.length).toBeGreaterThan(0);
      result.forEach(hour => {
        expect(hour.id).toBeTruthy();
      });
    });

    it('should create location hours', async () => {
      const newLocationHours = [1, 2, 3, 4, 5].map(day => ({
        location: newLocation,
        dayOfWeek: day, // ISO day -> 0-6 starts on Sunday
        isOpen: true,
        startTime: '08:00:00',
        endTime: '17:00:00',
      })) as LocationHour[];
      await hoursService.saveLocationHours(newLocationHours);
      const hours = await hoursService.getLocationHours(newLocation.id);
      hours.forEach((hour, index) => {
        expect(hour.dayOfWeek).toBe(newLocationHours[index].dayOfWeek);
        expect(hour.isOpen).toBe(newLocationHours[index].isOpen);
        expect(hour.startTime).toBe(newLocationHours[index].startTime);
        expect(hour.endTime).toBe(newLocationHours[index].endTime);
      });
    });

    it('should update location hours', async () => {
      const hours = await hoursService.getLocationHours(newLocation.id);
      hours.forEach(hour => {
        expect(hour.isOpen).toBe(true);
        hour.isOpen = false; // changed to false
        hour.location = newLocation;
      });

      await hoursService.saveLocationHours(hours);

      const updatedHours = await hoursService.getLocationHours(newLocation.id);
      updatedHours.forEach(hour => {
        const isFound = hours.find(data => data.id === hour.id);
        expect(isFound).toBeTruthy();
        expect(hour.isOpen).toBe(false);
      });
    });

    it('should report a review', async () => {
      const locations = await locationService.findWithFilter({
        search: 'ISBX',
      });
      const ratings = await locationService.getReviews(locations[0][0].id);

      const review = await locationService.getReview(
        locations[0][0].id,
        ratings[0][0].id,
      );
      expect(review.id).toBe(ratings[0][0].id);
      expect(review.location).toBeTruthy();
      expect(review.user).toBeTruthy();

      const sendTo = await userService.getUsersReportReviewNotif(
        locations[0][0].id,
      );
      expect(sendTo).toBeInstanceOf(Array);
      sendTo.map(async data => {
        const fromAddress = configService.get('email.from'); // official app email address
        const emailNotification = locationService.composeReportReviewEmail(
          review,
          data,
          user,
        );
        expect(emailNotification.subject).toBe('GreenDirect: Report Review');
        expect(emailNotification.from).toBe(fromAddress);
        expect(emailNotification.to).toBe(
          `${[data.firstName, data.lastName].join(' ')} <${data.email}>`,
        );
        expect(emailNotification.template).toBeTruthy();
        expect(emailNotification.context).toBeTruthy();

        // send report review notif
      });
    });

    it('should return the nearest Clinica Verde location within 0.5 mile radius', async () => {
      const expectedNearestLocation = 'ISBX';
      // userLocation.lat and .lng is the same coordinate for ISBX (Test)
      // which must be  returned as the nearest location
      const nearestLocation: LocationSearchDto = await locationService.getNearestLocation(
        null,
        userLocation.lat,
        userLocation.lng,
      );

      expect(nearestLocation.name).toEqual(
        expect.stringContaining(expectedNearestLocation),
      );
    });

    it('should check-in', async () => {
      const location = await locationService.findWithFilter({ search: 'ISBX' });
      const mock: MobileCheckInDto = {
        locationId: location[0][0].id,
        mobileNumber:
          `+1-555` +
          `-${Math.random()
            .toString(10)
            .substr(2, 3)}` +
          `-${Math.random()
            .toString(10)
            .substr(2, 4)}`,
      };

      const addedMobileCheckIn: MobileCheckIn = await locationService.checkIn(
        mock,
      );

      const foundMobileCheckIn: MobileCheckIn = await mobileCheckInService.findById(
        addedMobileCheckIn.id,
      );

      expect(addedMobileCheckIn.id).toBe(foundMobileCheckIn.id);
      expect(addedMobileCheckIn.mobileNumber).toBe(
        foundMobileCheckIn.mobileNumber,
      );
    });

    it('should get organization POS Info to match expected schema', async () => {
      const locations = await locationService.findWithFilter({
        search: 'NextGen Dispensary',
      });
      const location = locations[1] ? _.first(locations[0]) : null;
      const posInfo = await locationService.getLocationPosInfo(location.id);

      // no need to check contents
      expect(posInfo).toHaveProperty('locationId');
      expect(posInfo).toHaveProperty('locationPosId');
      expect(posInfo).toHaveProperty('organizationPosId');
      expect(posInfo).toHaveProperty('pos');
      expect(posInfo).toHaveProperty('posConfig');
    });

    it(`Should be able to create product (user as admin)`, async () => {
      const locations = await locationService.findWithFilter({
        search: 'NextGen Dispensary',
      });
      const location = locations[0][0];
      const newProduct = {
        name: faker.commerce.productName(),
        pricingType: PricingType.Unit,
        pricing: {
          price: parseFloat(faker.commerce.price()),
        },
      } as Product;

      const result = await locationController.createProduct(
        location.id,
        newProduct,
        {
          user: admin,
        },
      );
      expect(result).toBeTruthy();
    });

    it(`Should be able to update product (user as admin)`, async () => {
      const locations = await locationService.findWithFilter({
        search: 'NextGen Dispensary',
      });
      const location = locations[0][0];
      const newProduct = await fixtureService.saveEntityUsingValues(Product, {
        location: { id: location.id },
      });

      const productToUpdate = {
        id: newProduct.id,
        name: newProduct.name + '-updated',
      } as UpdateProductDto;

      const result = await locationController.updateProduct(
        location.id,
        newProduct.id,
        productToUpdate,
        {
          user: admin,
        },
      );

      expect(result).toBeTruthy();
      expect(result.name).toBe(productToUpdate.name);
    });

    it(`Should be able to create product (user as site admin)`, async () => {
      const assignedLocations = await userLocationService.getAllByUserId(
        siteAdmin.id,
      );
      expect((assignedLocations || []).length).toBeGreaterThan(0);

      const location = assignedLocations[0].location;
      const newProduct = {
        name: faker.commerce.productName(),
        pricingType: PricingType.Unit,
        pricing: {
          price: parseFloat(faker.commerce.price()),
        },
      } as Product;

      const result = await locationController.createProduct(
        location.id,
        newProduct,
        {
          user: siteAdmin,
        },
      );
      expect(result).toBeTruthy();
    });

    it(`Should be able to update product (user as site admin)`, async () => {
      const assignedLocations = await userLocationService.getAllByUserId(
        siteAdmin.id,
      );
      expect((assignedLocations || []).length).toBeGreaterThan(0);

      const location = assignedLocations[0].location;
      const newProduct = await fixtureService.saveEntityUsingValues(Product, {
        location: { id: location.id },
      });

      const productToUpdate = {
        id: newProduct.id,
        name: newProduct.name + '-updated',
      } as UpdateProductDto;

      const result = await locationController.updateProduct(
        location.id,
        newProduct.id,
        productToUpdate,
        {
          user: admin,
        },
      );

      expect(result).toBeTruthy();
      expect(result.name).toBe(productToUpdate.name);
    });
  });

  // TODO add suite for supertest tests (http requests level test)

  describe('Expected Exceptions', () => {
    it('should not allow to save hours with invalid time range', async () => {
      const locations = await locationService.findWithFilter({
        search: 'ISBX',
      });
      const hours = [
        {
          location: locations[0][0],
          dayOfWeek: 6, // ISO day -> 0-6 starts on Sunday
          isOpen: true,
          startTime: '17:00:00',
          endTime: '08:00:00',
        },
      ] as LocationHour[];

      const { invalidTimeRange: EXPECTED } = LocationExceptions;
      expect.assertions(2); // assures that assertions get called in an async method
      try {
        await hoursService.saveLocationHours(hours);
      } catch (error) {
        expect(error.getStatus()).toEqual(EXPECTED.httpStatus);
        expect(error.message).toEqual(EXPECTED.message);
      }
    });

    it('should not allow to add a review within 30 days', async () => {
      const locations = await locationService.findWithFilter({
        search: 'ISBX',
      });

      const rating = new LocationRating();
      rating.location = new Location();
      rating.user = new User();
      rating.location.id = locations[0][0].id;
      rating.user.id = user.id;
      rating.firstName = user.firstName;
      rating.lastName = user.lastName;
      rating.review = 'Test Again';
      rating.rating = 5;

      const { addReviewSpam: EXPECTED } = LocationExceptions;
      expect.assertions(2); // assures that assertions get called in an async method
      try {
        await locationService.createReview(rating);
      } catch (error) {
        expect(error.getStatus()).toEqual(EXPECTED.httpStatus);
        expect(error.message).toEqual(EXPECTED.message);
      }
    });

    it('should not allow starting lat missing', async () => {
      const { invalidStartingLatLong: EXPECTED } = LocationExceptions;
      expect.assertions(2); // assures that assertions get called in an async method
      try {
        await locationController.search(
          '',
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          userLocation.lng,
        ); // failed to provide starting location latitude
      } catch (error) {
        expect(error.getStatus()).toEqual(EXPECTED.httpStatus);
        expect(error.message).toEqual(EXPECTED.message);
      }
    });

    it('should not allow starting lng missing', async () => {
      const { invalidStartingLatLong: EXPECTED } = LocationExceptions;
      expect.assertions(2); // assures that assertions get called in an async method
      try {
        await locationController.search(
          '',
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          userLocation.lat,
          null,
        ); // failed to provide starting location longitude
      } catch (error) {
        expect(error.getStatus()).toEqual(EXPECTED.httpStatus);
        expect(error.message).toEqual(EXPECTED.message);
      }
    });

    it('should not allow to report a review if review not exist', async () => {
      const locations = await locationService.findWithFilter({
        search: 'ISBX',
      });
      const { reviewNotFound: EXPECTED } = LocationExceptions;
      expect.assertions(2); // assures that assertions get called in an async method
      try {
        await locationController.reportReview(locations[0][0].id, 999, {
          user,
        });
      } catch (error) {
        expect(error.getStatus()).toEqual(EXPECTED.httpStatus);
        expect(error.message).toEqual(EXPECTED.message);
      }
    });

    it('should not allow to check-in if mobile number is missing', async () => {
      const location = await locationService.findWithFilter({ search: 'ISBX' });
      const mock: MobileCheckInDto = {
        locationId: location[0][0].id,
      };

      const { mobileNumberRequired: EXPECTED } = LocationExceptions;
      expect.assertions(2); // assures that assertions get called in an async method
      try {
        await locationService.checkIn(mock);
      } catch (error) {
        expect(error.getStatus()).toEqual(EXPECTED.httpStatus);
        expect(error.message).toEqual(EXPECTED.message);
      }
    });

    it('should not allow to check-in if no location found', async () => {
      const mock: MobileCheckInDto = {
        locationId: 99999,
        mobileNumber:
          `+1-555` +
          `-${Math.random()
            .toString(10)
            .substr(2, 3)}` +
          `-${Math.random()
            .toString(10)
            .substr(2, 4)}`,
      };

      const { locationNotFound: EXPECTED } = LocationExceptions;
      expect.assertions(2); // assures that assertions get called in an async method
      try {
        await locationService.checkIn(mock);
      } catch (error) {
        expect(error.getStatus()).toEqual(EXPECTED.httpStatus);
        expect(error.message).toEqual(EXPECTED.message);
      }
    });

    it('should not allow to check-in twice or more in the same calendar day', async () => {
      const location = await locationService.findWithFilter({ search: 'ISBX' });
      const mock: MobileCheckInDto = {
        locationId: location[0][0].id,
        mobileNumber:
          `+1-555` +
          `-${Math.random()
            .toString(10)
            .substr(2, 3)}` +
          `-${Math.random()
            .toString(10)
            .substr(2, 4)}`,
      };
      await locationService.checkIn(mock);

      const { checkinRestricted: EXPECTED } = LocationExceptions;
      expect.assertions(2); // assures that assertions get called in an async method
      try {
        // Second check-in should not go through
        await locationService.checkIn(mock);
      } catch (error) {
        expect(error.getStatus()).toEqual(EXPECTED.httpStatus);
        expect(error.message).toEqual(EXPECTED.message);
      }
    });

    it('should not get a nearest location when long and lat are missing', async () => {
      const { longLatRequired: EXPECTED } = LocationExceptions;
      expect.assertions(2); // assures that assertions get called in an async method
      try {
        await locationService.getNearestLocation(null, null, null);
      } catch (error) {
        expect(error.getStatus()).toEqual(EXPECTED.httpStatus);
        expect(error.message).toEqual(EXPECTED.message);
      }
    });

    it('should not get nearest location when CV location is not within 0.5 mile radius', async () => {
      // Hundred miles away from ISBX Coordinate
      const startFromLat = 33.0135573;
      const startFromLng = -118.419058;
      const { nearestLocationNotFound: EXPECTED } = LocationExceptions;
      expect.assertions(2); // assures that assertions get called in an async method
      try {
        await locationService.getNearestLocation(
          null,
          startFromLat,
          startFromLng,
        );
      } catch (error) {
        expect(error.getStatus()).toEqual(EXPECTED.httpStatus);
        expect(error.message).toEqual(EXPECTED.message);
      }
    });

    it('should not allow toggling location off-hours when company off-hours is disabled', async () => {
      const [locations, count] = await locationService.findWithFilter({
        search: 'ISBX',
      });
      const [location] = locations;
      expect(count).toBeTruthy();
      expect(location.organization.allowOffHours).toBe(false);

      const { organizationOffHoursDisabled: EXPECTED } = OrganizationExceptions;
      try {
        const locationUpdate = {
          id: location.id,
          allowOffHours: true,
        } as Location;
        await locationController.update(location.id, locationUpdate);
      } catch (error) {
        expect(error.getStatus()).toEqual(EXPECTED.httpStatus);
        expect(error.message).toEqual(EXPECTED.message);
      }
    });
  });

  it(`Should not create product if user (site-admin) not assign to location`, async () => {
    const assignedLocations = await userLocationService.getAllByUserId(
      siteAdmin.id,
    );
    expect((assignedLocations || []).length).toBeGreaterThan(0);

    const [locations] = await locationService.findWithFilter({
      search: 'Cannacity Shop',
    });
    expect((locations || []).length).toBeGreaterThan(0);

    const notAssignLocation = locations[0];

    // Check if location is assigned to the user
    const isFound = !!assignedLocations.find(
      assignedLocation =>
        assignedLocation.location &&
        assignedLocation.location.id === notAssignLocation.id,
    );
    expect(isFound).toBeFalsy();

    const newProduct = {
      name: faker.commerce.productName(),
      pricingType: PricingType.Unit,
      pricing: {
        price: parseFloat(faker.commerce.price()),
      },
    } as Product;
    const { notAssignedToLocation: EXPECTED } = UserLocationExceptions;
    try {
      await locationController.createProduct(notAssignLocation.id, newProduct, {
        user: siteAdmin,
      });
    } catch (error) {
      expect(error.getStatus()).toEqual(EXPECTED.httpStatus);
      expect(error.message).toEqual(EXPECTED.message);
    }
  });

  it(`Should not update product if user (site-admin) not assign to location`, async () => {
    const assignedLocations = await userLocationService.getAllByUserId(
      siteAdmin.id,
    );
    expect((assignedLocations || []).length).toBeGreaterThan(0);

    const [locations] = await locationService.findWithFilter({
      search: 'Cannacity Shop',
    });
    expect((locations || []).length).toBeGreaterThan(0);

    const notAssignLocation = locations[0];

    // Check if location is assigned to the user
    const isFound = !!assignedLocations.find(
      assignedLocation =>
        assignedLocation.location &&
        assignedLocation.location.id === notAssignLocation.id,
    );
    expect(isFound).toBeFalsy();

    const newProduct = await fixtureService.saveEntityUsingValues(Product, {
      location: { id: notAssignLocation.id },
    });

    const productToUpdate = {
      id: newProduct.id,
      name: newProduct.name + '-updated',
    } as UpdateProductDto;

    const { notAssignedToLocation: EXPECTED } = UserLocationExceptions;
    try {
      await locationController.updateProduct(
        notAssignLocation.id,
        newProduct.id,
        productToUpdate,
        {
          user: siteAdmin,
        },
      );
    } catch (error) {
      expect(error.getStatus()).toEqual(EXPECTED.httpStatus);
      expect(error.message).toEqual(EXPECTED.message);
    }
  });
});
