import { ApiModelProperty } from '@nestjs/swagger';

export class LocationInventoryStatsDto {
  @ApiModelProperty()
  locationId: number;
  @ApiModelProperty()
  inStockCount: number;
  @ApiModelProperty()
  outOfStockCount: number;
}
